const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion } = require("mongodb");

// Middleware
app.use(cors());
app.use(express.json()); // to parse JSON request bodies

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.b5ecy6m.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("parcelDB");
    const parcelCollection = db.collection("parcels");

    app.get("/parcels", async (req, res) => {
      const parcels = await parcelCollection.find().toArray();
      res.send(parcels);
    });

    // post
    app.post("/parcels", async (req, res) => {
      const newParcel = req.body;
      try {
        const newParcel = req.body;
        // newParcel.createdAt = new Data();
        const result = await parcelCollection.insertOne(newParcel);
        res.status(201).send(result);
      } catch (error) {
        console.error("error inserting  parcel:", error);
        res.send(500).send({ message: "Failed to create parcel: " });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

// Test route
app.get("/", (req, res) => {
  res.send("Parcel server is running!");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
