export interface Review {
  id: string
  user_id: string
  order_item_id: string
  product_id: string
  created_at: string
  review_content: string
  review_title: string
}

export interface ReviewRating {
  id: string
  product_id: string
  review_id: string
  rate: Number
}

export interface ReviewResponse extends Review {
  rate: Number,
  username: string,
  photo_url?: string
  product_name: string
  quantity: string
  variant_id: string
  variant_option_id: string
  variant_name: string
  variant_value: string
}
