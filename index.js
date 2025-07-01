const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const e = require("express");
const admin = require("firebase-admin");

dotenv.config();
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

// Middleware
app.use(cors());
app.use(express.json());

const serviceAccount = require("./firebase-admin-key.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.b5ecy6m.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("parcelDB");
    const parcelCollection = db.collection("parcels");
    const paymentCollection = db.collection("payments");
    const trackingsCollection = db.collection("trackings");
    const usersCollection = db.collection("users");

    // custom middleware: verify Firebase ID token
    const verifyFBToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        return res.status(401).send({ message: "Unauthorized access" });
      }

      const token = authHeader.split(" ")[1];

      if (!token) {
        return res.status(401).send({ message: "Unauthorized access" });
      }

      try {
        // verify Firebase ID token
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next(); // proceed to next middleware or route
      } catch (error) {
        console.error("Token verification failed:", error);
        return res.status(403).send({ message: "Forbidden access" });
      }
    };

    // POST /users
    app.post("/users", async (req, res) => {
      try {
        const email = req.body.email;
        const userExists = await usersCollection.findOne({ email });

        if (userExists) {
          return res
            .status(200)
            .send({ message: "User already exists", inserted: false });
        }

        const user = {
          ...req.body,
          created_at: new Date().toISOString(),
        };

        const result = await usersCollection.insertOne(user);
        res.send({ message: "User created", inserted: true, result });
      } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).send({ message: "Server error", error });
      }
    });

    // GET parcels (all or filtered by email)
    app.get("/parcels", async (req, res) => {
      try {
        const userEmail = req.query.email;
        const query = userEmail ? { email: userEmail } : {};
        const parcels = await parcelCollection
          .find(query)
          .sort({ creation_timestamp: -1 }) // sort latest first
          .toArray();
        res.send(parcels);
      } catch (error) {
        console.error("error fetching parcels ", error);
        res.status(500).send({ message: "Failed to get parcels" });
      }
    });

    // POST new parcel
    app.post("/parcels", async (req, res) => {
      try {
        const newParcel = req.body;
        newParcel.createdAt = new Date();
        const result = await parcelCollection.insertOne(newParcel);
        res.status(201).send(result);
      } catch (error) {
        console.error("error inserting parcel:", error);
        res.status(500).send({ message: "Failed to create parcel" });
      }
    });

    // GET a single parcel by ID
    app.get("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid parcel ID" });
        }

        const parcel = await parcelCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!parcel) {
          return res.status(404).send({ message: "Parcel not found" });
        }

        res.send(parcel);
      } catch (error) {
        console.error("Error fetching parcel by ID:", error);
        res.status(500).send({ message: "Failed to fetch parcel" });
      }
    });

    // DELETE parcel by ID
    app.delete("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid parcel ID" });
        }
        const result = await parcelCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Parcel not found" });
        }
        res.send({ message: "Parcel deleted successfully" });
      } catch (error) {
        console.error("error deleting parcel:", error);
        res.status(500).send({ message: "Failed to delete parcel" });
      }
    });

    // payment success
    app.post("/create-payment-intent", async (req, res) => {
      const amountInCents = req.body.amount;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: "bdt",
          payment_method_types: ["card"],
        });
        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    /* ───────── POST  /payments ─ record a payment & mark parcel as paid ───────── */
    app.post("/payments", async (req, res) => {
      const { parcelId, email, amount, paymentMethod, transactionId } =
        req.body;

      /* 1. basic validation */
      if (!ObjectId.isValid(parcelId))
        return res.status(400).json({ message: "Invalid parcel ID" });
      if (!amount || amount <= 0)
        return res.status(400).json({ message: "Amount must be > 0" });

      /* 2. run both writes inside a MongoDB transaction */
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          /* a. update the parcel */
          const parcelUpdate = await parcelCollection.updateOne(
            { _id: new ObjectId(parcelId) },
            {
              $set: {
                payment_status: "paid",
                paidAt: new Date(),
                transactionId,
              },
            },
            { session }
          );
          if (parcelUpdate.matchedCount === 0)
            throw new Error("Parcel not found or already removed");

          /* b. insert a payment‑history record */
          await paymentCollection.insertOne(
            {
              parcelId: new ObjectId(parcelId),
              email,
              amount,
              paymentMethod,
              transactionId,
              paidAt: new Date(),
            },
            { session }
          );
        });

        res
          .status(201)
          .json({ message: "Payment recorded and parcel marked as paid" });
      } catch (err) {
        console.error("Payment‑txn error:", err);
        res.status(500).json({ message: err.message || "Payment save failed" });
      } finally {
        await session.endSession();
      }
    });

    /* ─────── Create tracking update ─────── */
    app.post("/trackings", async (req, res) => {
      const {
        tracking_id,
        parcel_id,
        status,
        message = "",
        updated_by = "",
      } = req.body;

      if (!tracking_id || !status)
        return res
          .status(400)
          .json({ message: "Tracking ID and status are required." });

      const trackDoc = {
        tracking_id,
        parcel_id:
          parcel_id && ObjectId.isValid(parcel_id)
            ? new ObjectId(parcel_id)
            : undefined,
        status,
        message,
        updated_by,
        updatedAt: new Date(),
      };

      try {
        const result = await trackingsCollection.insertOne(trackDoc);
        res.status(201).json({ insertedId: result.insertedId });
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to insert tracking update." });
      }
    });

    /* ───────── GET  /payment-history ─ newest first, optional user filter ───────── */
    app.get("/payments", verifyFBToken, async (req, res) => {
      try {
        const { email } = req.query;
        const query = email ? { email } : {};

        const history = await paymentCollection
          .find(query)
          .sort({ paidAt: -1 })
          .toArray();

        res.json(history);
      } catch (err) {
        console.error("Load payment history error:", err);
        res.status(500).json({ message: "Failed to fetch payment history" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB successfully!");
  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Parcel server is running!");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
