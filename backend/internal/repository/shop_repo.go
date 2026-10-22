package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

var (
	ErrProductNotFound = errors.New("product not found")
	ErrEmptyCart       = errors.New("cart is empty")
)

// StockError is returned by PlaceOrder when a product has fewer units left
// than the cart asks for.
type StockError struct {
	Product   string
	Available int
}

func (e *StockError) Error() string {
	return fmt.Sprintf("not enough stock for %s (%d left)", e.Product, e.Available)
}

type ShopProduct struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	PriceCents  int64  `json:"price_cents"`
	Stock       int    `json:"stock"`
}

type ShopOrderLine struct {
	Name       string `json:"name"`
	Quantity   int    `json:"quantity"`
	PriceCents int64  `json:"price_cents"`
}

type ShopOrder struct {
	ID         int             `json:"id"`
	Status     string          `json:"status"`
	TotalCents int64           `json:"total_cents"`
	CreatedAt  time.Time       `json:"created_at"`
	Lines      []ShopOrderLine `json:"lines"`
}

// ShopRepository reads products and places orders. It takes a plain *sql.DB,
// so it does not depend on any of your other repositories.
type ShopRepository struct {
	db *sql.DB
}

func NewShopRepository(db *sql.DB) *ShopRepository {
	return &ShopRepository{db: db}
}

// escapeLike makes user text safe to use inside an ILIKE pattern.
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	return strings.ReplaceAll(s, `_`, `\_`)
}

// SearchProducts finds active products by keyword (name or description) and
// an optional maximum price. An empty query matches everything.
func (r *ShopRepository) SearchProducts(ctx context.Context, query string, maxCents int64, limit int) ([]ShopProduct, error) {
	if limit <= 0 || limit > 50 {
		limit = 8
	}
	query = strings.TrimSpace(query)
	pattern := "%" + escapeLike(query) + "%"

	rows, err := r.db.QueryContext(ctx, `
		SELECT id, name, description, price_cents, stock
		FROM shop_products
		WHERE active
		  AND ($1 = '' OR name ILIKE $2 OR description ILIKE $2)
		  AND ($3::bigint = 0 OR price_cents <= $3::bigint)
		ORDER BY name
		LIMIT $4`,
		query, pattern, maxCents, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanProducts(rows)
}

// ListProducts returns every active product (up to 200).
func (r *ShopRepository) ListProducts(ctx context.Context) ([]ShopProduct, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, name, description, price_cents, stock
		FROM shop_products
		WHERE active
		ORDER BY name
		LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanProducts(rows)
}

func (r *ShopRepository) GetProduct(ctx context.Context, id int) (ShopProduct, error) {
	var p ShopProduct
	err := r.db.QueryRowContext(ctx, `
		SELECT id, name, description, price_cents, stock
		FROM shop_products
		WHERE id = $1 AND active`, id).
		Scan(&p.ID, &p.Name, &p.Description, &p.PriceCents, &p.Stock)
	if errors.Is(err, sql.ErrNoRows) {
		return ShopProduct{}, ErrProductNotFound
	}
	return p, err
}

func scanProducts(rows *sql.Rows) ([]ShopProduct, error) {
	var out []ShopProduct
	for rows.Next() {
		var p ShopProduct
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.PriceCents, &p.Stock); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ListOrders returns a customer's most recent orders, newest first, with lines.
func (r *ShopRepository) ListOrders(ctx context.Context, userID string, limit int) ([]ShopOrder, error) {
	if limit <= 0 || limit > 20 {
		limit = 5
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT id, status, total_cents, created_at
		FROM shop_orders
		WHERE user_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	var orders []ShopOrder
	for rows.Next() {
		var o ShopOrder
		if err := rows.Scan(&o.ID, &o.Status, &o.TotalCents, &o.CreatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		orders = append(orders, o)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	// At most 20 orders, so one small query each is fine.
	for i := range orders {
		lineRows, err := r.db.QueryContext(ctx, `
			SELECT name, quantity, price_cents
			FROM shop_order_items
			WHERE order_id = $1
			ORDER BY id`, orders[i].ID)
		if err != nil {
			return nil, err
		}
		for lineRows.Next() {
			var l ShopOrderLine
			if err := lineRows.Scan(&l.Name, &l.Quantity, &l.PriceCents); err != nil {
				lineRows.Close()
				return nil, err
			}
			orders[i].Lines = append(orders[i].Lines, l)
		}
		err = lineRows.Err()
		lineRows.Close()
		if err != nil {
			return nil, err
		}
	}
	return orders, nil
}

// PlaceOrder turns a cart (product id -> quantity) into an order inside one
// transaction. Prices and stock always come from the database, never from the
// cart, and each product row is locked while its stock is checked and reduced,
// so two customers can never both buy the last item.
func (r *ShopRepository) PlaceOrder(ctx context.Context, userID string, cart map[int]int) (ShopOrder, error) {
	if len(cart) == 0 {
		return ShopOrder{}, ErrEmptyCart
	}

	ids := make([]int, 0, len(cart))
	for id, qty := range cart {
		if qty < 1 || qty > 20 {
			return ShopOrder{}, fmt.Errorf("invalid quantity %d for product %d", qty, id)
		}
		ids = append(ids, id)
	}
	sort.Ints(ids) // always lock rows in the same order to avoid deadlocks

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return ShopOrder{}, err
	}
	defer tx.Rollback() // a no-op after a successful Commit

	type line struct {
		productID int
		ShopOrderLine
	}
	var (
		lines []line
		total int64
	)
	for _, id := range ids {
		qty := cart[id]

		var (
			name  string
			price int64
			stock int
		)
		err := tx.QueryRowContext(ctx, `
			SELECT name, price_cents, stock
			FROM shop_products
			WHERE id = $1 AND active
			FOR UPDATE`, id).Scan(&name, &price, &stock)
		if errors.Is(err, sql.ErrNoRows) {
			return ShopOrder{}, fmt.Errorf("product %d: %w", id, ErrProductNotFound)
		}
		if err != nil {
			return ShopOrder{}, err
		}
		if stock < qty {
			return ShopOrder{}, &StockError{Product: name, Available: stock}
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE shop_products SET stock = stock - $2 WHERE id = $1`, id, qty); err != nil {
			return ShopOrder{}, err
		}

		lines = append(lines, line{productID: id, ShopOrderLine: ShopOrderLine{Name: name, Quantity: qty, PriceCents: price}})
		total += price * int64(qty)
	}

	order := ShopOrder{Status: "placed", TotalCents: total}
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO shop_orders (user_id, status, total_cents)
		VALUES ($1, 'placed', $2)
		RETURNING id, created_at`, userID, total).Scan(&order.ID, &order.CreatedAt); err != nil {
		return ShopOrder{}, err
	}

	for _, l := range lines {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO shop_order_items (order_id, product_id, name, quantity, price_cents)
			VALUES ($1, $2, $3, $4, $5)`,
			order.ID, l.productID, l.Name, l.Quantity, l.PriceCents); err != nil {
			return ShopOrder{}, err
		}
		order.Lines = append(order.Lines, l.ShopOrderLine)
	}

	if err := tx.Commit(); err != nil {
		return ShopOrder{}, err
	}
	return order, nil
}
