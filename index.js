const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 3000;

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

dotenv.config();

// Stripe for payments
const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

// Middleware: Enable CORS for cross-origin requests & parse JSON bodies
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin SDK for verifying Firebase auth tokens
const serviceAccount = require("./firebase-admin-key.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// MongoDB connection URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.b5ecy6m.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a new MongoClient for connecting to MongoDB
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Main async function to connect and set up routes
async function run() {
  try {
    // Connect to MongoDB
    await client.connect();

    // Get database and collections
    const db = client.db("parcelDB");
    const parcelCollection = db.collection("parcels");
    const paymentCollection = db.collection("payments");
    const trackingsCollection = db.collection("trackings");
    const usersCollection = db.collection("users");
    const ridersCollection = db.collection("riders");

    /*
      Custom middleware to verify Firebase ID Token.
      This middleware extracts the token from the `Authorization` header,
      verifies it with Firebase Admin SDK, and attaches decoded info to req.
      If token missing or invalid, it returns 401 or 403 error.
    */
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
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next(); // Token valid, proceed
      } catch (error) {
        console.error("Token verification failed:", error);
        return res.status(403).send({ message: "Forbidden access" });
      }
    };

    /* -------------- USER ROUTES -------------- */

    // POST /users - Create a new user if email not exists
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

    // PATCH /users/:id - Update user profile by MongoDB ObjectId
    app.patch("/users/:id", async (req, res) => {
      const { id } = req.params;
      const updatedFields = req.body;

      // Validate ID format
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid user ID" });
      }

      try {
        // Update fields in the user document
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedFields }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send(result);
      } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    /* -------------- PARCEL ROUTES -------------- */

    // GET /parcels - Get parcels; if query param email present, filter by email
    app.get("/parcels", verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.query.email;
        const query = userEmail ? { email: userEmail } : {};
        const parcels = await parcelCollection
          .find(query)
          .sort({ creation_timestamp: -1 }) // newest first
          .toArray();
        res.send(parcels);
      } catch (error) {
        console.error("error fetching parcels ", error);
        res.status(500).send({ message: "Failed to get parcels" });
      }
    });

    // POST /parcels - Add new parcel document
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

    // GET /parcels/:id - Get parcel by MongoDB ObjectId
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

    // DELETE /parcels/:id - Delete parcel by ID
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

    /* -------------- PAYMENT ROUTES -------------- */

    // POST /create-payment-intent - Create Stripe payment intent
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

    // POST /payments - Record payment and update parcel status in a MongoDB transaction
    app.post("/payments", async (req, res) => {
      const { parcelId, email, amount, paymentMethod, transactionId } =
        req.body;

      // Validate parcelId and amount
      if (!ObjectId.isValid(parcelId))
        return res.status(400).json({ message: "Invalid parcel ID" });
      if (!amount || amount <= 0)
        return res.status(400).json({ message: "Amount must be > 0" });

      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          // a. Update parcel payment status
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

          // b. Insert payment record
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

    /* -------------- TRACKING ROUTES -------------- */

    // POST /trackings - Create a tracking update record
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

    /* -------------- PAYMENT HISTORY ROUTE -------------- */

    // GET /payments - Get payment history, optionally filtered by email; requires Firebase token
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

    /* -------------- RIDER ROUTES -------------- */

    // POST /riders - Rider application submission
    app.post("/riders", async (req, res) => {
      try {
        const { email } = req.body;

        if (!email) {
          return res.status(400).json({ message: "Email is required" });
        }

        // Check if user already applied
        const existing = await ridersCollection.findOne({ email });
        if (existing) {
          return res.status(200).json({
            message: "You have already applied",
            inserted: false,
          });
        }

        const riderDoc = {
          ...req.body,
          status: "pending",
          submittedAt: new Date(),
        };

        const result = await ridersCollection.insertOne(riderDoc);
        res.status(201).json({
          message: "Application submitted",
          inserted: true,
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Error submitting rider application:", error);
        res.status(500).json({ message: "Failed to submit application" });
      }
    });

    // GET /riders - Get riders filtered by status
    app.get("/riders", async (req, res) => {
      const { status } = req.query;
      const filter = status ? { status } : {};
      const result = await ridersCollection.find(filter).toArray();
      res.send(result);
    });

    // PATCH /riders/approve/:id - Approve a rider by ID
    app.patch("/riders/approve/:id", async (req, res) => {
      const id = req.params.id;
      const { email } = req.body;
      try {
        // Approve the rider
        const riderResult = await ridersCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: "approved",
              approvedAt: new Date(),
            },
          }
        );
        // If rider was approved, also update the user role
        if (email) {
          const userQuery = { email };
          const userUpdateDoc = {
            $set: {
              role: "rider",
            },
          };

          await usersCollection.updateOne(userQuery, userUpdateDoc);
        }
        res.send(riderResult);
      } catch (error) {
        console.error("Approval error:", error);
        res.status(500).send({ message: "Server error during approval" });
      }
    });

    // ✅ NEW: GET /users/:uid - Fetch user by Firebase UID
    app.get("/users/:id", async (req, res) => {
      const uid = req.params.uid;

      try {
        const user = await usersCollection.findOne({ uid });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send(user);
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // user search api
    // app.get("/users/search", async (req, res) => {
    //   const email = req.query.email;
    //   if (!email) return res.status(400).send({ message: "Email is required" });

    //   const regex = new RegExp(email, "i");
    //   try {
    //     const users = await usersCollection
    //       .find({ email: { regex: regex } })
    //       .project({ email: 1, createdAt: 1, role: 1 })
    //       .limit(10)
    //       .toArray();
    //     res.send(users);
    //   } catch (error) {
    //     console.error("Error searching users", error);
    //     res.status(500).send({ message: "Error searching users" });
    //   }
    // });

    // //patch api
    // app.patch("/users/:id/role", async (req, res) => {
    //   const { role } = req.body;
    //   const { id } = req.params;

    //   if (!["admin", "user", "rider"].includes(role)) {
    //     return res.status(400).send({ message: "Invalid role" });
    //   }

    //   const result = await usersCollection.updateOne(
    //     { _id: new ObjectId(id) },
    //     { $set: { role } }
    //   );

    //   res.send(result);
    // });

   
    // Updated /users/search endpoint
    app.get("/users/search", async (req, res) => {
      const searchTerm = req.query.term || req.query.email; // Support both parameters
      if (!searchTerm) {
        return res.status(400).json({
          success: false,
          message: "Search term is required",
        });
      }

      try {
        const users = await usersCollection
          .find({
            $or: [
              { email: { $regex: searchTerm, $options: "i" } },
              { uid: { $regex: searchTerm, $options: "i" } },
            ],
          })
          .project({
            _id: 1,
            email: 1,
            uid: 1,
            name: 1,
            role: 1,
            createdAt: 1,
            last_log_in: 1,
          })
          .limit(10)
          .toArray();

        res.json({
          success: true,
          data: users,
          count: users.length,
        });
      } catch (error) {
        console.error("Search error:", error);
        res.status(500).json({
          success: false,
          message: "Internal server error",
        });
      }
    });

    // Updated role update endpoint
    app.patch("/users/:id/role", async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;

      // Validate input
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({
          success: false,
          message: "Invalid user ID format",
        });
      }

      if (!["admin", "user", "rider"].includes(role)) {
        return res.status(400).send({
          success: false,
          message: "Invalid role specified",
        });
      }

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "User not found",
          });
        }

        res.send({
          success: true,
          message: "User role updated successfully",
          data: result,
        });
      } catch (error) {
        console.error("Error updating user role:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update user role",
          error: error.message,
        });
      }
    });

    // MongoDB connection test
    await client.db("admin").command({ ping: 1 });
    console.log("Connected to MongoDB successfully!");
  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}
run().catch(console.dir);

// Basic root endpoint to verify server is running
app.get("/", (req, res) => {
  res.send("Parcel server is running!");
});

// Start server on defined port
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
