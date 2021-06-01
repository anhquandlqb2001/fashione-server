export interface Product {
  name: string;
  category_ids: string[];
  thumbnail_url: string;
  price: string
}

export interface Detail {
  description: string;
}

export interface Option {
  value: string;
  price: string;
  quantity: number;
  image_url: string[];
}

export interface Variant {
  name: string;
  options: Option[];
}

export interface ResponseBody {
  product: Product;
  detail: Detail;
  variants: Variant[];
}