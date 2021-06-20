import { BigQuery } from '@google-cloud/bigquery';
import algoliasearch from 'algoliasearch';
import cors from 'cors';
import express, { Request, Response } from "express";
import admin, { firestore } from "firebase-admin";
import { ResponseBody } from "product.type";
import { DeviceToken, ENotificationType, NotificationExtend, NotificationOrderStatus, NotificationType } from "./types/notification.type";
import {
	EOrderItemStatus, OrderItem, OrderItemStatusFirebaseResponse,
	OrderItemStatusRequest
} from "./types/order.type";
import { Review, ReviewRating, ReviewResponse } from "./types/review.type";
import { EnumSaleType, SaleRequestData } from './types/sales.type';

const client = algoliasearch(process.env.ALGOLIA_API_ID, process.env.ALGOLIA_API_KEY);
const index = client.initIndex('dev_products');

admin.initializeApp({
	credential: admin.credential.cert(
		"./fashione-4356d-firebase-adminsdk-x05j7-3171fbde15.json"
	),
});

const app = express();

app.use(cors({
	origin: "*"
}))

app.use(express.json());

const db = admin.firestore();
const auth = admin.auth();
const query = new BigQuery({ projectId: process.env.GOOGLE_CLOUD_PROJECT });

const PER_PAGE = 9;


/**
 * MOST_VIEW in 30 day
 * SELECT
	params.value.string_value AS product_id,
	COUNT(params.value.string_value) AS count
FROM
	`fashione-4356d.analytics_274329586.events_*`,
	UNNEST(event_params) AS params
WHERE
	PARSE_DATE('%Y%m%d',
		_TABLE_SUFFIX) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
	AND CURRENT_DATE()
	AND event_name = "select_item"
	AND params.key = "item_id"
GROUP BY
	product_id
ORDER BY count
 */

const most_view_query = "SELECT " +
	"params.value.string_value AS product_id, " +
	"COUNT(params.value.string_value) AS count " +
	"FROM " +
	'`fashione-4356d.analytics_274329586.events_*`, ' +
	`UNNEST(event_params) AS params
WHERE
PARSE_DATE('%Y%m%d',
	_TABLE_SUFFIX) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
AND CURRENT_DATE()
AND event_name = "select_item"
AND params.key = "item_id"
GROUP BY product_id
ORDER BY count DESC
LIMIT 10`

app.get("/products/most_view", async (req, res) => {
	try {
		const simpleQueryRowsResponse = await query.query({ query: most_view_query, useLegacySql: false })
		return res.json({ ids: simpleQueryRowsResponse[0].map(it => it.product_id) })
	} catch (error) {
		console.log(error);

	}
})

app.get("/hot", async (req, res) => {
	try {
		const lastVisibleId = req.query.last_visible_id;

		if (!lastVisibleId) {
			const productResponse = await db
				.collection("products")
				.orderBy("created_at", "desc")
				.limit(PER_PAGE + 1)
				.get();


			if (productResponse.empty) {
				// if prd is empty then return
				return res.json({ data: [], last_visible_id: null });
			}
			const product = getFirestoreObjectWithId(
				productResponse.docs
			)

			return res.json({
				data: product,
				last_visible_id: getLastVisibleDocumentId(product),
			});
		}

		const docRef = db.collection("products").doc(lastVisibleId as string);
		const snapshot = await docRef.get();
		const startAtSnapshot = db
			.collection("products")
			.orderBy("created_at", "desc")
			.startAfter(snapshot);

		const productResponse = await startAtSnapshot.limit(PER_PAGE + 1).get();
		if (productResponse.empty) {
			// if prod is empty then return
			res.json({ data: [], lastVisibleId: null });
			return;
		}
		const products = getFirestoreObjectWithId(productResponse.docs) as Review[];
		return res.json({
			data: products,
			last_visible_id: getLastVisibleDocumentId(products),
		});
	} catch (error) {
		console.log(error);

		res.json(error);
	}
})

app.get("/reviews", async (req, res) => {
	try {
		const productId = req.query.product_id;
		const lastVisibleId = req.query.last_visible_id;

		if (!lastVisibleId) {
			const reviewsResponse = await db
				.collection("reviews")
				.where("product_id", "==", productId as string)
				.orderBy("created_at", "desc")
				.limit(PER_PAGE + 1)
				.get();


			if (reviewsResponse.empty) {
				// if reviews is empty then return
				return res.json({ data: [], last_visible_id: null });
			}
			const reviews = getFirestoreObjectWithId(
				reviewsResponse.docs
			) as Review[];
			const response = await reviewResponseFactory(reviews);

			return res.json({
				data: response,
				last_visible_id: getLastVisibleDocumentId(reviews),
			});
		}

		const docRef = db.collection("reviews").doc(lastVisibleId as string);
		const snapshot = await docRef.get();
		const startAtSnapshot = db
			.collection("reviews")
			.where("product_id", "==", productId as string)
			.orderBy("created_at", "desc")
			.startAfter(snapshot);

		const reviewsResponse = await startAtSnapshot.limit(PER_PAGE + 1).get();
		if (reviewsResponse.empty) {
			// if reviews is empty then return
			res.json({ data: [], lastVisibleId: null });
			return;
		}
		const reviews = getFirestoreObjectWithId(reviewsResponse.docs) as Review[];
		const response = await reviewResponseFactory(reviews);
		return res.json({
			data: response,
			last_visible_id: getLastVisibleDocumentId(reviews),
		});
	} catch (error) {
		console.log(error);

		res.json(error);
	}
});

app.get("/order/status", async (req, res) => {
	try {
		const idToken = req.query.token as string;
		const decodedIdToken = await auth.verifyIdToken(idToken);

		const orderStatusResponse = await db.collection("order_statuses").where("user_id", "==", decodedIdToken.uid).get()

		const snapshot = await db
			.collection("order_item_statuses")
			.where(firestore.FieldPath.documentId(), "in", orderStatusResponse.docs.map(it => it.data().current_order_item_status_id))
			.select(firestore.FieldPath.documentId(), "status")
			.get();

		const readAbleData = getFirestoreObjectWithId(
			snapshot.docs
		) as OrderItemStatusFirebaseResponse[];

		const orderItemStatuses = enumKeys(EOrderItemStatus).map(status => {
			const orderStatus = readAbleData.filter(it => it.status == status)
			return {
				status: status,
				quantity: orderStatus.length
			} as OrderItemStatusRequest
		})
		return res.json(orderItemStatuses)
	} catch (error) {
		console.log(error);
		res.json([]);
	}
});

app.post("/order/status", async (req, res) => {
	try {
		const status = req.body.status as EOrderItemStatus
		const orderItemId = req.body.order_item_id

		const orderItemStatusResponse = await db.collection("order_item_statuses").where("order_item_id", "==", orderItemId).get()

		const orderItemStatus = getFirestoreObjectWithId(orderItemStatusResponse.docs)

		if (!orderItemStatus.some(it => it.status == status)) { // if not found any => create new one
			const ref = await db.collection("order_item_statuses").add({
				order_id: orderItemStatus[0].order_id,
				order_item_id: orderItemStatus[0].order_item_id,
				user_id: orderItemStatus[0].user_id,
				status: status,
				created_at: firestore.FieldValue.serverTimestamp()
			})

			const doc = await db.collection("order_statuses").where("order_item_id", "==", orderItemId).limit(1).get()

			await db.collection("order_statuses").doc(doc.docs[0].id).update({ "current_order_item_status_id": ref.id })
			return res.json(true)
		}

		return res.json(false)

	} catch (error) {
		return res.json(false)
	}
})

app.post("/notification/token", async (req, res) => {
	try {
		const { userId, token } = req.body as DeviceToken;
		const deviceToken = { userId: userId, token: token } as DeviceToken;
		const deviceTokenFirestore = await db
			.collection("device_tokens")
			.where("user_id", "==", deviceToken.userId)
			.get();

		const deviceTokenFirestoreWithId = getFirestoreObjectWithId(
			deviceTokenFirestore.docs
		)[0];

		return res.json(
			await updateOrCreate(
				deviceTokenFirestore,
				deviceTokenFirestoreWithId,
				deviceToken
			)
		);
	} catch (error) {
		console.log(error);
	}
});

app.get("/notification/overview", async (req: Request, res: Response) => {
	try {
		const uid = req.query.uid as string;

		const notificationTypeResponse = await db
			.collection("notification_types")
			.get();
		const notificationTypes = getFirestoreObjectWithId(
			notificationTypeResponse.docs
		) as NotificationType[];

		const notificationPromises = notificationTypes.map(
			async (notificationType) => {
				const notificationResponse = await db
					.collection("notifications")
					.where("recipient_id", "==", uid)
					.where("type_id", "==", notificationType.id)
					.select()
					.get();
				return {
					type: notificationType,
					quantity: notificationResponse.size,
				};
			}
		);

		const notifications = await Promise.all(notificationPromises);
		const totalNotification = notifications.reduce((x, y) => x + y.quantity, 0);
		return res.json({ notifications: notifications, total: totalNotification });
	} catch (error) {
		console.log(error);
	}
});

app.post("/order", async (req, res) => {
	try {
		const order = req.body.order;
		const orderItems = req.body.order_items as OrderItem[];

		// create order
		const orderReponse = await db.collection("orders").add(order);

		// create order item
		const orderItemBatch = db.batch();
		const orderItemIds: string[] = orderItems.map((orderItem: OrderItem) => {
			const ref = db.collection("order_items").doc();
			orderItemBatch.set(ref, {
				...orderItem,
				order_id: orderReponse.id,
				user_id: order.user_id,
			});
			return ref.id;
		});
		await orderItemBatch.commit();

		const orderItemStatusBatch = db.batch();
		const orderStatuseBatch = db.batch()
		orderItemIds.forEach((id) => {
			console.log(id);

			const orderItemStatusRef = db.collection("order_item_statuses").doc();
			orderItemStatusBatch.set(orderItemStatusRef, {
				order_id: orderReponse.id,
				order_item_id: id,
				user_id: order.user_id,
				status: EOrderItemStatus[EOrderItemStatus.CONFIRMING],
				created_at: firestore.FieldValue.serverTimestamp()
			});

			const orderStatusRef = db.collection("order_statuses").doc();
			orderStatuseBatch.set(orderStatusRef, {
				order_id: orderReponse.id,
				order_item_id: id,
				user_id: order.user_id,
				current_order_item_status_id: orderItemStatusRef.id,
			})
		});
		await orderItemStatusBatch.commit();
		await orderStatuseBatch.commit()


		// update cart
		const docs = await db
			.collection("carts")
			.where(
				"variant_option_id",
				"in",
				orderItems.map((it) => it.variant_option_id)
			)
			.get();

		const cartBatch = db.batch();
		docs.forEach((doc) => {
			cartBatch.delete(doc.ref);
		});
		cartBatch.commit();

		return res.json(true);
	} catch (error) {
		console.log(error);
	}
});

app.post("/notification/:type/", async (req, res) => {
	try {
		let userId = req.params.user_id as any
		const payload = req.body.payload as admin.messaging.MessagingPayload
		const type = req.params.type

		if (!userId) {
			const users = await admin.auth().listUsers()
			userId = users.users.map(it => it.uid)
		} else {
			userId = [userId]
		}

		const deviceTokenResponse = await db.collection("device_tokens").where("user_id", "in", userId).get()
		const deviceTokens = deviceTokenResponse.docs.map(it => it.data())
		const typeResponse = await db.collection("notification_types").where("name", "==", type.toUpperCase()).get()
		const notificationId = typeResponse.docs[0].id

		const notificationPromises = deviceTokens.map(async token => {
			const notification: NotificationExtend = {
				created_at: firestore.FieldValue.serverTimestamp(),
				deleted: false,
				read: false,
				device_id: token.token,
				recipient_id: token.user_id,
				type_id: notificationId,
				data: {
					payload: payload
				}
			}

			return await db.collection("notifications").add(notification)
		})
		await Promise.all(notificationPromises)
		res.json(true)
	} catch (error) {
		console.log(error);
		res.json(false)
	}
})

app.post("/live", async (req, res) => {
	try {
		const video = req.body.video
		const ref = await db.collection("live_videos").add(video)
		console.log(ref.id);

		return res.json(ref.id)
	} catch (error) {
		console.log(error);
	}
})

app.delete("/live", async (req, res) => {
	try {
		const id = req.query.id
		await db.collection("live_videos").doc(id as string).delete()
	} catch (error) {

	}
})

app.post("/product", async (req, res) => {
	try {
		const product = req.body as ResponseBody

		// Add product
		const productRef = await db.collection("products").add({ ...product.product, created_at: firestore.FieldValue.serverTimestamp() })
		// Add product detail
		await db.collection("product_detail").add({
			...product.detail,
			product_id: productRef.id
		})

		// Add product variants, options, image
		const productVariantBatch = db.batch()
		const productVariantOptionBatch = db.batch()
		const productImageBatch = db.batch()
		product.variants.forEach(variant => {
			const variantRef = db.collection("product_variants").doc()
			productVariantBatch.set(variantRef, { product_id: productRef.id, name: variant.name })
			variant.options.forEach(option => {
				const variantOptionRef = db.collection("product_variant_options").doc()
				productVariantOptionBatch.set(variantOptionRef, { variant_id: variantRef.id, value: option.value, price: option.price, quantity: option.quantity })
				option.image_url.forEach(image => {
					const productImageRef = db.collection("product_images").doc()
					productImageBatch.set(productImageRef, { product_id: productRef.id, variant_id: variantRef.id, variant_option_id: variantOptionRef.id, url: image })
				})
			})
		})
		await productVariantBatch.commit()
		await productVariantOptionBatch.commit()
		await productImageBatch.commit()
		return res.json(true)
	} catch (error) {
		console.log(error);
		return res.json(false)
	}
})

app.post("/message", async (req, res) => {
	try {
		const body = req.body
		await db.collection("messages").add({ ...body, created_at: firestore.FieldValue.serverTimestamp() })
		return res.json(true)
	} catch (e) {
		console.log(e)
		return res.json(false)
	}
})


app.post("/sales", async (req, res) => {
	try {
		const { sale } = req.body as SaleRequestData

		const createdAt = firestore.Timestamp.now().toMillis()
		const expiredAt = createdAt + milliseconds(sale.time)

		await db.collection("sales").add({ ...sale, sale_type: EnumSaleType[sale.sale_type], created_at: firestore.FieldValue.serverTimestamp(), expired_at: firestore.Timestamp.fromMillis(expiredAt) })
		return res.json(true)
	} catch (error) {
		console.log(error);
	}
})

const milliseconds = (h: number) => ((h * 60 * 60) * 1000);

/**
 * observe -> push notification   
 * */
db.collection("order_item_statuses").onSnapshot(
	(querySnapshot) => {
		if (querySnapshot.docChanges().length != 1) {
			return;
		}
		querySnapshot
			.docChanges()
			.slice(0, 1)
			.forEach(async (doc) => {
				try {
					const data = doc.doc.data();

					if (data.status == EOrderItemStatus[EOrderItemStatus.COMPLETE]) {
						return
					}

					const userId = data.user_id;
					const response = await db
						.collection("device_tokens")
						.where("user_id", "==", userId)
						.get();

					const deviceToken = response.docs[0].data().token

					// data for save db
					const notificationTypeResponse = await db.collection("notification_types").where("name", "==", ENotificationType[ENotificationType.ORDER_STATUS]).get()
					const notificationType = getFirestoreObjectWithId(notificationTypeResponse.docs)[0]

					const orderItemResponse = await db.collection("order_items").doc(doc.doc.data().order_item_id).get()
					const orderItem = orderItemResponse.data()
					const productImageResponse = await db.collection("product_images")
						.where("variant_option_id", "==", orderItem.variant_option_id)
						.get()

					console.log(productImageResponse);


					const notification: NotificationOrderStatus = {
						deleted: false,
						read: false,
						device_id: deviceToken,
						created_at: firestore.FieldValue.serverTimestamp(),
						type_id: notificationType.id,
						data: {
							product: {
								order_id: orderItem.order_id,
								order_item_id: orderItemResponse.id
							},
							payload: {}
						},
						recipient_id: userId
					}

					console.log("1");

					// push notification
					if (data.status != EOrderItemStatus[EOrderItemStatus.DELIVERED]) {
						const payload: admin.messaging.MessagingPayload = {
							notification: { title: "Cập nhật trạng thái đơn hàng" }
						}
						switch (data.status) {
							case EOrderItemStatus[EOrderItemStatus.COLLECTING]:
								payload.notification.body = "Đơn hàng của bạn đang được xuất kho"

								break;
							case EOrderItemStatus[EOrderItemStatus.DELIVERING]:

								payload.notification.body = "Đơn hàng của bạn đang được vận chuyển"

								break;
							case EOrderItemStatus[EOrderItemStatus.CONFIRMING]:
								payload.notification.body = "Đơn hàng đang được xác nhận bởi shop"

								break;
							default:
								break;
						}

						payload.notification.image = productImageResponse.docs[0].data().url
						const push = await pushNotification(deviceToken, payload)
						console.log("push", push);

						notification.data.payload = payload // update payload to object
						await db.collection("notifications").add(notification) // save db
						return
					}

					const payload = {
						notification: {
							title: "Giao hàng thành công",
							body: "Kiện hàng của bạn đã được giao thành công đến bạn",
							image:
								productImageResponse.docs[0].data().url,
						},
					} as admin.messaging.MessagingPayload;
					console.log(2);

					const push = await pushNotification(deviceToken, payload)
					console.log(push);
					console.log(3);


					notification.data.payload = payload // update payload to object
					await db.collection("notifications").add(notification) // save db
					return
				} catch (error) {
					console.log(error);
				}
			});
	},
	(err) => {
		console.log(`Encountered error: ${err}`);
	}
);

db.collection("products").onSnapshot((snapshot) => {
	if (snapshot.docChanges().length != 1) {
		return;
	}
	snapshot
		.docChanges()
		.slice(0, 1)
		.forEach(async (doc) => {
			try {
				const exist = await db.collection("products").doc(doc.doc.id).get()
				if (!exist.exists) {
					return
				}
				const detailRef = await db.collection("product_detail").where("product_id", "==", exist.id).get()

				const data = doc.doc.data();
				const prod = { id: doc.doc.id, ...data, description: detailRef.docs[0].data().description }
				await index.saveObject(prod, { autoGenerateObjectIDIfNotExist: true })
			} catch (e) {
				console.log(e);
			}
		})
})

app.listen(3000, () => console.log("connected"));


const pushNotification = async (token: string, payload: admin.messaging.MessagingPayload) => {
	return await admin
		.messaging()
		.sendToDevice(token, payload);
}

const getLastVisibleDocumentId = (reviews: Review[]): string | null => {
	if (reviews.length == PER_PAGE + 1) return reviews[reviews.length - 1].id;
	return null;
};

const getFirestoreObjectWithId = (
	data: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>[]
) => data.map((it) => ({ id: it.id, ...it.data() }));

const reviewResponseFactory = async (reviews: Review[]) => {
	const ratingsResponse = await db
		.collection("review_ratings")
		.where(
			"review_id",
			"in",
			reviews.map((it) => it.id)
		)
		.get();
	const ratings = getFirestoreObjectWithId(
		ratingsResponse.docs
	) as ReviewRating[];
	const users = await auth.getUsers(reviews.map((it) => ({ uid: it.user_id })));

	const ordersResponse = await db
		.collection("order_items")
		.where(
			firestore.FieldPath.documentId(),
			"in",
			reviews.map((it) => it.order_item_id)
		)
		.get();
	const orders = getFirestoreObjectWithId(ordersResponse.docs) as OrderItem[];

	return reviews.map((review) => {
		const order = orders.filter((order) => order.id == review.order_item_id)[0];
		const user = users.users.filter((user) => user.uid == review.user_id)[0];
		return {
			...review,
			rate: ratings.filter((rating) => rating.review_id == review.id)[0].rate,
			photo_url: user.photoURL,
			username: user.displayName,
			quantity: order.quantity,
			product_name: order.product_name,
			variant_id: order.variant_id,
			variant_option_id: order.variant_option_id,
			variant_name: order.variant_name,
			variant_value: order.variant_value,
		} as ReviewResponse;
	});
};

const updateOrCreate = async (
	deviceTokenFirestore: firestore.QuerySnapshot<firestore.DocumentData>,
	deviceTokenFirestoreWithId: { id: string },
	deviceToken: DeviceToken
) => {
	try {
		if (deviceTokenFirestore.empty) {
			await db
				.collection("device_tokens")
				.add({ user_id: deviceToken.userId, token: deviceToken.token });

			return true;
		}

		await db
			.collection("device.tokens")
			.doc(deviceTokenFirestoreWithId.id)
			.update({ user_id: deviceToken.userId, token: deviceToken.token });
		return true;
	} catch (error) {
		return false;
	}
};

function enumKeys<O extends object, K extends keyof O = keyof O>(obj: O): K[] {
	return Object.keys(obj).filter(k => Number.isNaN(+k)) as K[];
}