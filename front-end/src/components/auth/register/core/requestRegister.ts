import axios from "axios";
import {RegisterPayload} from "./model";

const API_BASE_URL = "http://localhost:8000/api/v1";


export async function registerRequest(payload: RegisterPayload) {
    const res = await axios.post(`${API_BASE_URL}/signup`, payload);
    return res.data;
}

