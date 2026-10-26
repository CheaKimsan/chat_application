import { FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState, KeyboardEvent } from "react";
import { AxiosError } from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    ArrowRight,
    Bot,
    Check,
    ChevronDown,
    LoaderCircle,
    Minus,
    Package,
    Plus,
    Search,
    Send,
    ShoppingBag,
    Sparkles,
    Trash2,
    UserRound,
} from "lucide-react";
import {
    reqListShopOrders,
    reqListShopProducts,
    reqPlaceShopOrder,
    reqShopAssistantReply,
    ShopOrder,
    ShopProduct,
} from "../../api/apiClient";

type ShopTab = "catalog" | "orders" | "assistant";
type CartItem = { product: ShopProduct; quantity: number };
type AssistantMessage = { id: number; role: "user" | "assistant"; text: string };

const assistantPrompts = [
    "Which products are in stock?",
    "Suggest a gift under $30.",
    "What is the most affordable item?",
];

const formatPrice = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

function errorMessage(error: unknown, fallback: string) {
    if (error instanceof AxiosError) {
        const responseMessage = (error.response?.data as { error?: string } | undefined)?.error;
        if (responseMessage) return responseMessage;
    }
    return fallback;
}

export default function ShopPage() {
    const queryClient = useQueryClient();
    const [tab, setTab] = useState<ShopTab>("catalog");
    const [search, setSearch] = useState("");
    const [maxPrice, setMaxPrice] = useState("");
    const [cart, setCart] = useState<Record<number, CartItem>>({});
    const [notice, setNotice] = useState("");
    const [confirmingOrder, setConfirmingOrder] = useState(false);
    const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
    const [assistantDraft, setAssistantDraft] = useState("");
    const [assistantError, setAssistantError] = useState("");
    const [isAssistantSending, setIsAssistantSending] = useState(false);

    const nextAssistantMessageID = useRef(0);
    const assistantEndRef = useRef<HTMLDivElement | null>(null);
    const assistantInputRef = useRef<HTMLTextAreaElement | null>(null);

    const deferredSearch = useDeferredValue(search.trim());
    const maxCents = maxPrice.trim() ? Math.round(Number(maxPrice) * 100) : undefined;

    const productsQuery = useQuery({
        queryKey: ["shop-products", deferredSearch, maxCents],
        queryFn: () => reqListShopProducts({ q: deferredSearch || undefined, max_cents: maxCents }),
        enabled: tab === "catalog",
    });
    const ordersQuery = useQuery({
        queryKey: ["shop-orders"],
        queryFn: reqListShopOrders,
        enabled: tab === "orders",
    });

    const cartItems = Object.values(cart);
    const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
    const cartTotal = cartItems.reduce((sum, item) => sum + item.product.price_cents * item.quantity, 0);

    const orderMutation = useMutation({
        mutationFn: () => reqPlaceShopOrder(Object.fromEntries(cartItems.map(({ product, quantity }) => [product.id, quantity]))),
        onSuccess: async (order: ShopOrder) => {
            setCart({});
            setConfirmingOrder(false);
            setNotice(`Order #${order.id} placed successfully.`);
            setTab("orders");
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["shop-orders"] }),
                queryClient.invalidateQueries({ queryKey: ["shop-products"] }),
            ]);
        },
    });

    const sortedItems = useMemo(
        () => [...cartItems].sort((a, b) => a.product.name.localeCompare(b.product.name)),
        [cartItems],
    );

    const addToCart = (product: ShopProduct) => {
        setNotice("");
        setCart((current) => {
            const existing = current[product.id];
            const quantity = Math.min((existing?.quantity ?? 0) + 1, Math.min(product.stock, 20));
            return { ...current, [product.id]: { product, quantity } };
        });
    };

    const changeQuantity = (productID: number, amount: number) => {
        setCart((current) => {
            const item = current[productID];
            if (!item) return current;
            const quantity = Math.min(item.quantity + amount, Math.min(item.product.stock, 20));
            if (quantity < 1) {
                const next = { ...current };
                delete next[productID];
                return next;
            }
            return { ...current, [productID]: { ...item, quantity } };
        });
    };

    const removeFromCart = (productID: number) => {
        setCart((current) => {
            const next = { ...current };
            delete next[productID];
            return next;
        });
    };

    // Auto-scroll AI thread
    useEffect(() => {
        assistantEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [assistantMessages, isAssistantSending]);

    // Auto-grow AI textarea
    useEffect(() => {
        const el = assistantInputRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }, [assistantDraft]);

    const sendAssistantMessage = async (value: string) => {
        const message = value.trim();
        if (!message || isAssistantSending) return;

        setAssistantDraft("");
        setAssistantError("");
        setAssistantMessages((current) => [...current, {
            id: nextAssistantMessageID.current++,
            role: "user",
            text: message,
        }]);
        setIsAssistantSending(true);
        try {
            const conversation = [...assistantMessages, { role: "user" as const, text: message }]
                .map((entry) => `${entry.role === "user" ? "Customer" : "Shop AI"}: ${entry.text}`)
                .join("\n\n")
                .slice(-3000);
            const reply = await reqShopAssistantReply(`Continue this conversation and answer the latest customer message:\n\n${conversation}`);
            setAssistantMessages((current) => [...current, {
                id: nextAssistantMessageID.current++,
                role: "assistant",
                text: reply,
            }]);
        } catch (error) {
            setAssistantError(errorMessage(error, "Shop AI could not respond. Please try again."));
        } finally {
            setIsAssistantSending(false);
        }
    };

    const submitAssistantMessage = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void sendAssistantMessage(assistantDraft);
    };

    const handleAssistantKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void sendAssistantMessage(assistantDraft);
        }
    };

    const handlePriceChange = (value: string) => {
        if (value === "" || /^\d{0,7}(\.\d{0,2})?$/.test(value)) setMaxPrice(value);
    };

    return (
        <section className="shop-page" aria-label="Shop">
            <header className="shop-heading">
                <div>
                    <p className="shop-eyebrow">THE STORE</p>
                    <h1>Good things, thoughtfully chosen.</h1>
                    <p className="shop-heading__copy">Browse what’s available, then place an order securely.</p>
                </div>
                <div className="shop-heading__mark" aria-hidden="true"><ShoppingBag size={24} /></div>
            </header>

            <div className="shop-toolbar">
                <div className="shop-tabs" role="tablist" aria-label="Shop sections">
                    <button className={tab === "catalog" ? "is-active" : ""} role="tab" aria-selected={tab === "catalog"} onClick={() => { setTab("catalog"); setNotice(""); }}>
                        Catalog
                    </button>
                    <button className={tab === "orders" ? "is-active" : ""} role="tab" aria-selected={tab === "orders"} onClick={() => { setTab("orders"); setNotice(""); }}>
                        Orders
                    </button>
                    <button className={tab === "assistant" ? "is-active" : ""} role="tab" aria-selected={tab === "assistant"} onClick={() => { setTab("assistant"); setNotice(""); }}>
                        <Sparkles size={14} /> Shop AI
                    </button>
                </div>
                {tab === "catalog" && (
                    <div className="shop-filters">
                        <label className="shop-search">
                            <Search size={16} aria-hidden="true" />
                            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" aria-label="Search products" />
                        </label>
                        <label className="shop-price-filter">
                            <span>Up to</span>
                            <span className="shop-price-filter__input"><span>$</span><input inputMode="decimal" value={maxPrice} onChange={(event) => handlePriceChange(event.target.value)} placeholder="Any" aria-label="Maximum price in dollars" /></span>
                        </label>
                    </div>
                )}
            </div>

            {notice && <div className="shop-notice" role="status"><Check size={16} />{notice}</div>}

            {tab === "assistant" ? (
                <section className="shop-ai" aria-label="Shop AI">
                    <header className="shop-ai__header">
                        <span className="shop-ai__mark" aria-hidden="true"><Sparkles size={18} /></span>
                        <div><p className="shop-eyebrow">PRODUCT GUIDE</p><h2>Shop AI</h2></div>
                    </header>
                    <div className="shop-ai__thread" aria-live="polite">
                        {assistantMessages.length === 0 ? (
                            <div className="shop-ai__welcome">
                                <h3>Find something that fits.</h3>
                                <div className="shop-ai__prompts" aria-label="Suggested questions">
                                    {assistantPrompts.map((prompt) => (
                                        <button key={prompt} type="button" disabled={isAssistantSending} onClick={() => void sendAssistantMessage(prompt)}>
                                            {prompt}<ArrowRight size={14} />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : assistantMessages.map((message) => (
                            <article className={`shop-ai__message shop-ai__message--${message.role}`} key={message.id}>
                                <span className="shop-ai__avatar" aria-hidden="true">
                                    {message.role === "assistant" ? <Bot size={15} /> : <UserRound size={15} />}
                                </span>
                                <div><span>{message.role === "assistant" ? "Shop AI" : "You"}</span><p>{message.text}</p></div>
                            </article>
                        ))}
                        {isAssistantSending && (
                            <div className="shop-ai__pending" role="status"><LoaderCircle className="shop-ai__spinner" size={16} /> Checking the catalog…</div>
                        )}
                        <div ref={assistantEndRef} />
                    </div>
                    {assistantError && <p className="shop-ai__error" role="alert">{assistantError}</p>}
                    <form className="shop-ai__composer" onSubmit={submitAssistantMessage}>
                        <textarea
                            ref={assistantInputRef}
                            value={assistantDraft}
                            onChange={(event) => setAssistantDraft(event.target.value)}
                            onKeyDown={handleAssistantKeyDown}
                            placeholder="Ask about a product, price, or stock..."
                            aria-label="Ask Shop AI"
                            maxLength={4000}
                            rows={1}
                            disabled={isAssistantSending}
                        />
                        <button type="submit" disabled={!assistantDraft.trim() || isAssistantSending} title="Send message" aria-label="Send message">
                            {isAssistantSending ? <LoaderCircle className="shop-ai__spinner" size={17} /> : <Send size={16} />}
                        </button>
                    </form>
                </section>
            ) : tab === "catalog" ? (
                <div className="shop-content">
                    <section className="shop-catalog" aria-label="Product catalog">
                        <div className="shop-section-title">
                            <div><h2>Available now</h2><p>{productsQuery.data?.length ?? 0} items</p></div>
                            <ChevronDown size={17} aria-hidden="true" />
                        </div>
                        {productsQuery.isLoading ? (
                            <div className="shop-state" role="status">Loading products…</div>
                        ) : productsQuery.isError ? (
                            <div className="shop-state shop-state--error" role="alert">
                                <p>{errorMessage(productsQuery.error, "Could not load products.")}</p>
                                <button type="button" onClick={() => void productsQuery.refetch()}>Retry</button>
                            </div>
                        ) : productsQuery.data?.length ? (
                            <div className="shop-product-grid">
                                {productsQuery.data.map((product, index) => {
                                    const quantity = cart[product.id]?.quantity ?? 0;
                                    const unavailable = product.stock < 1;
                                    return (
                                        <article className="shop-product" key={product.id} style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
                                            <div className={`shop-product__art shop-product__art--${index % 4}`} aria-hidden="true">
                                                <span>{String(index + 1).padStart(2, "0")}</span>
                                                <Package size={36} strokeWidth={1.2} />
                                            </div>
                                            <div className="shop-product__info">
                                                <div className="shop-product__topline">
                                                    <h3>{product.name}</h3>
                                                    <strong>{formatPrice(product.price_cents)}</strong>
                                                </div>
                                                <p>{product.description || "A considered addition to your everyday."}</p>
                                                <div className="shop-product__bottomline">
                                                    <span className={unavailable ? "shop-stock shop-stock--empty" : "shop-stock"}>
                                                        {unavailable ? "Out of stock" : `${product.stock} in stock`}
                                                    </span>
                                                    <button type="button" onClick={() => addToCart(product)} disabled={unavailable || quantity >= Math.min(product.stock, 20)}>
                                                        {quantity ? <><Check size={15} /> Added {quantity}</> : <><Plus size={15} /> Add</>}
                                                    </button>
                                                </div>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="shop-state"><Package size={26} /><p>No products match those filters.</p></div>
                        )}
                    </section>

                    <aside className="shop-bag" aria-label="Shopping bag">
                        <div className="shop-bag__heading"><div><p className="shop-eyebrow">YOUR SELECTION</p><h2>Shopping bag <span>{cartCount}</span></h2></div><ShoppingBag size={20} /></div>
                        {sortedItems.length === 0 ? (
                            <div className="shop-bag__empty"><span><ShoppingBag size={20} /></span><p>Your bag is waiting.</p><small>Add something from the catalog.</small></div>
                        ) : (
                            <>
                                <div className="shop-bag__items">
                                    {sortedItems.map(({ product, quantity }) => (
                                        <div className="shop-bag-item" key={product.id}>
                                            <div className="shop-bag-item__info"><strong>{product.name}</strong><span>{formatPrice(product.price_cents)}</span></div>
                                            <div className="shop-bag-item__controls">
                                                <button type="button" aria-label={`Remove one ${product.name}`} onClick={() => changeQuantity(product.id, -1)}><Minus size={13} /></button>
                                                <span>{quantity}</span>
                                                <button type="button" aria-label={`Add one ${product.name}`} disabled={quantity >= Math.min(product.stock, 20)} onClick={() => changeQuantity(product.id, 1)}><Plus size={13} /></button>
                                                <button className="shop-bag-item__remove" type="button" aria-label={`Remove ${product.name} from bag`} onClick={() => removeFromCart(product.id)}><Trash2 size={14} /></button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="shop-bag__summary"><span>Subtotal</span><strong>{formatPrice(cartTotal)}</strong></div>
                                <p className="shop-bag__fineprint">Final total is confirmed when your order is placed.</p>
                                {orderMutation.isError && <p className="shop-error" role="alert">{errorMessage(orderMutation.error, "Could not place the order.")}</p>}
                                <button className="shop-checkout" type="button" disabled={orderMutation.isLoading} onClick={() => { setNotice(""); setConfirmingOrder(true); }}>
                                    Place order <ArrowRight size={16} />
                                </button>
                            </>
                        )}
                    </aside>
                </div>
            ) : (
                <section className="shop-orders" aria-label="Your orders">
                    <div className="shop-section-title"><div><h2>Order history</h2><p>Your latest purchases</p></div></div>
                    {ordersQuery.isLoading ? <div className="shop-state" role="status">Loading orders…</div> : ordersQuery.isError ? (
                        <div className="shop-state shop-state--error" role="alert"><p>{errorMessage(ordersQuery.error, "Could not load your orders.")}</p><button type="button" onClick={() => void ordersQuery.refetch()}>Retry</button></div>
                    ) : ordersQuery.data?.length ? (
                        <div className="shop-order-list">
                            {ordersQuery.data.map((order) => (
                                <article className="shop-order" key={order.id}>
                                    <header><div><span>ORDER #{order.id}</span><time dateTime={order.created_at}>{new Date(order.created_at).toLocaleDateString()}</time></div><span className="shop-order__status">{order.status}</span></header>
                                    <div className="shop-order__lines">{order.lines.map((line, index) => <div key={`${line.name}-${index}`}><span>{line.quantity} × {line.name}</span><span>{formatPrice(line.price_cents * line.quantity)}</span></div>)}</div>
                                    <footer><span>Total</span><strong>{formatPrice(order.total_cents)}</strong></footer>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <div className="shop-state"><Package size={26} /><p>No orders yet.</p><button type="button" onClick={() => setTab("catalog")}>Browse catalog</button></div>
                    )}
                </section>
            )}
            {confirmingOrder && (
                <div className="shop-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmingOrder(false); }}>
                    <section className="shop-confirm" role="dialog" aria-modal="true" aria-labelledby="shop-confirm-title">
                        <p className="shop-eyebrow">FINAL CHECK</p>
                        <h2 id="shop-confirm-title">Place this order?</h2>
                        <p>{cartCount} item{cartCount === 1 ? "" : "s"} · {formatPrice(cartTotal)}</p>
                        {orderMutation.isError && <p className="shop-error" role="alert">{errorMessage(orderMutation.error, "Could not place the order.")}</p>}
                        <div className="shop-confirm__actions">
                            <button type="button" onClick={() => { setConfirmingOrder(false); orderMutation.reset(); }}>Keep shopping</button>
                            <button type="button" disabled={orderMutation.isLoading} onClick={() => orderMutation.mutate()}>
                                {orderMutation.isLoading ? "Placing…" : "Confirm order"}
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </section>
    );
}