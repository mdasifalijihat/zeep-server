const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");


dotenv.config();
const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KAY); // Use your Stripe secret key
// Middleware
app.use(cors());
app.use(express.json());

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
