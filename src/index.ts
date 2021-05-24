import express, { Request, Response } from "express";
import admin, { firestore } from "firebase-admin";
import { DeviceToken, NotificationType } from "./types/notification.type";
import {
	OrderItemStatusFirebaseResponse,
	OrderItemStatusRequest,
	OrderItem,
	EOrderItemStatus,
} from "./types/order.type";
import { Review, ReviewRating, ReviewResponse } from "./types/review.type";

admin.initializeApp({
	credential: admin.credential.cert(
		"./fashione-2db2b-firebase-adminsdk-lfujc-b34de39ef8.json"
	),
});

const app = express();

app.use(express.json());

const db = admin.firestore();
const auth = admin.auth();

const PER_PAGE = 9;

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

			console.log(reviewsResponse.docs.map(it => it.data()));


			if (reviewsResponse.empty) {
				// if reviews is empty then return
				return res.json({ data: [], last_visible_id: null });
			}
			const reviews = getFirestoreObjectWithId(
				reviewsResponse.docs
			) as Review[];
			const response = await reviewResponseFactory(reviews);
			console.log(response);

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
		res.json(error);
	}
});

app.get("/order/status", async (req, res) => {
	try {
		const idToken = req.query.token as string;
		const decodedIdToken = await auth.verifyIdToken(idToken);

		const orderStatusResponse = await db.collection("order_statuses").where("user_id", "==", decodedIdToken.uid).get()
		console.log(orderStatusResponse.docs.map(it => it.id));

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
		// const dataPromises = readAbleData.map(async (item) => {
		// 	const snapshot = await db
		// 		.collection("order_items")
		// 		.where("order_id", "==", item.id)
		// 		.select()
		// 		.get();
		// 	return {
		// 		status: item.status,
		// 		quantity: snapshot.size,
		// 	} as DeliveryStatus;
		// });

		// const data = await Promise.all(dataPromises);
		// return res.json(deliveryStatusResponseFactory(data));
	} catch (error) {
		console.log(error);
		res.json(error);
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
		const token = req.query.token as string;
		const decodedIdToken = await auth.verifyIdToken(token);

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
					.where("recipient_id", "==", decodedIdToken.uid)
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

function enumKeys<O extends object, K extends keyof O = keyof O>(obj: O): K[] {
	return Object.keys(obj).filter(k => Number.isNaN(+k)) as K[];
}

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

/**
 * observe -> push notification   
 * */
const observeOrderItemStatus = db.collection("order_item_statuses").onSnapshot(
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
					if (data.status != "DELIVERED") {
						return;
					}
					const userId = data.user_id;
					const response = await db
						.collection("device_tokens")
						.where("user_id", "==", userId)
						.get();

					const payload = {
						notification: {
							title: "Đơn hàng của bạn đã được giao thành công",
							body: "",
							image:
								"https://i.vietgiaitri.com/2019/9/4/la-nguoi-thu-ba-toi-chet-dung-khi-doc-tin-nhan-anh-gui-vo-530a9a.jpg",
						},
					} as admin.messaging.MessagingPayload;
					const push = await admin
						.messaging()
						.sendToDevice(response.docs[0].data().token, payload);
					console.log(push);

				} catch (error) {
					console.log(error);
				}
			});

		// ...
	},
	(err) => {
		console.log(`Encountered error: ${err}`);
	}
);

app.listen(3000, () => console.log("connected"));

const deliveryStatusResponseFactory = (data: OrderItemStatusRequest[]) => {
	const arr = data.map((delivery) => {
		let sum = data
			.map((o) => {
				if (o.status == delivery.status) {
					return o.quantity;
				}
				return 0;
			})
			.reduce((a, c) => {
				return a + c;
			});
		return {
			status: delivery.status,
			quantity: sum,
		} as OrderItemStatusRequest;
	});
	return arr.filter(
		(v, i, a) => a.findIndex((t) => t.status === v.status) === i
	);
};

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
