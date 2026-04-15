require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
//  payment stripe key--------------
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const app = express();
const port = 5000;
// firebasee admin key---
const admin = require("firebase-admin");
const serviceAccount = require("./zap-shift-client-key.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
// middleware--------
app.use(cors());
app.use(express.json());
// token verify ----------
const verfiyFBToken = async (req, res, next) => {
  // console.log("headers in the middleware", req.headers.Authorization);
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "unauthorization access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token ", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    res.status(401).send({ message: "unauthorize access" });
  }
};
// db user-------------mongo db----
const uri = process.env.DB_USER;

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
    // collection-----------------
    const userCollection = client.db("parcelDB").collection("users");
    const parcelCollection = client.db("parcelDB").collection("parcels");
    const paymentCollection = client.db("parcelDB").collection("payments");
    const ridersCollection = client.db("parcelDB").collection("riders");
    // middle ware with database access  admin token
    // must be use after veryfiy token
    const veryfiyAdminToken = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden  access" });
      }
      next();
    };
    // users related api --------------------
    // user get
    app.get("/users", verfiyFBToken, veryfiyAdminToken, async (req, res) => {
      const cursor = userCollection.find().sort({ creation_time: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });
    // user id diye get query
    app.get("users/:id", async (req, res) => {});
    // user email role query admin
    app.get("/users/:email/role", verfiyFBToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user.role || "user" });
    });
    // user post
    app.post("/users", async (req, res) => {
      const user = req.body;
      // console.log("BODY:", req.body);
      user.role = "user";
      user.creation_time = new Date();
      const email = user.email;
      const userExists = await userCollection.findOne({ email });
      if (userExists) {
        return res.send({ message: "user exists" });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });
    // user patch
    app.patch(
      "/users/:id/role",
      verfiyFBToken,
      veryfiyAdminToken,
      async (req, res) => {
        const id = req.params.id;
        const roleInfo = req.body;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            role: roleInfo.role,
          },
        };
        const result = await userCollection.updateOne(query, updateDoc);
        res.send(result);
      },
    );
    // parcels api read  get
    app.get("/parcels", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.created_by = email;
      }
      // const options= {sort : { createdAt:-1}}
      const result = await parcelCollection
        .find(query)
        .sort({ creation_date: -1 })
        .toArray();
      res.send(result);
    });
    // add parcel post ------------
    app.post("/parcels", async (req, res) => {
      const data = req.body;
      const result = await parcelCollection.insertOne(data);
      res.send(result);
    });
    // parcel pay button -------
    app.get("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const query = { _id: new ObjectId(id) };

        const result = await parcelCollection.findOne(query);

        if (!result) {
          return res.status(404).send({ message: "Parcel not found" });
        }

        res.send(result);
      } catch (error) {
        res.status(400).send({ message: "Invalid ID" });
      }
    });
    // ---------------delete api parcel-----------
    app.delete("/parcels/:id", verfiyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await parcelCollection.deleteOne(query);
      res.send(result);
    });

    // payment checkout session
    app.post("/payment-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.deliveryCost) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              unit_amount: amount,
              currency: "USD",
              product_data: {
                name: paymentInfo.parcelName,
              },
            },

            quantity: 1,
          },
        ],
        customer_email: paymentInfo.created_by.toLowerCase(), //  LOGIN USER EMAIL
        mode: "payment",
        metadata: {
          parcelId: paymentInfo.parcelId,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cencelled`,
      });

      console.log(session);
      res.send({ url: session.url });
    });
    // old payment session
    // app.post("/create-checkout-session", async (req, res) => {
    //   const paymentInfo = req.body;
    //   const amount = parseInt(paymentInfo.deliveryCost) * 100;
    //   const session = await stripe.checkout.sessions.create({
    //     line_items: [
    //       {
    //         price_data: {
    //           unit_amount: amount,
    //           currency: "USD",
    //           product_data: {
    //             name: paymentInfo.parcelName,
    //           },
    //         },

    //         quantity: 1,
    //       },
    //     ],
    //     customer_email: paymentInfo.created_by,
    //     mode: "payment",
    //     metadata: {
    //       parcelId: paymentInfo.parcelId,
    //     },
    //     success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
    //     cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cencelled`,
    //   });

    //   console.log(session);
    //   res.send({ url: session.url });
    // });
    // patch--stripe-------------------------
    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(
        req.query.session_id,
      );
      // console.log(session)
      // repete control--------
      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const paymentExite = await paymentCollection.findOne(query);
      if (paymentExite) {
        return res.send({ message: "already exists", transactionId });
      }
      // paid
      if (session.payment_status === "paid") {
        const id = session.metadata.parcelId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            payment_status: "paid",
          },
        };
        const result = await parcelCollection.updateOne(query, update);

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email.toLowerCase(),
          parcelId: session.metadata.parcelId,
          transactionId: session.payment_intent,
          payment_status: session.payment_status,
          creation_time: new Date(),
          created: session.created, //  timestamp
        };
        if (session.payment_status === "paid") {
          const resultPayment = await paymentCollection.insertOne(payment);
          return res.send({
            successs: true,
            modifyParcel: result,
            transactionId: session.payment_intent,
            paymentInfo: resultPayment,
          });
        }
      }
      // console.log("session id ", sessionId);
      res.send({ success: false });
    });

    //---------------------------------------- payment reletaed api -------------
    // payment data get / read--token use
    app.get("/payments", verfiyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};

      // console.log('headers', req.headers)

      if (email) {
        query.customerEmail = email;
        // check email
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "forbbiden access" });
        }
      }
      const cursor = paymentCollection.find(query).sort({ created: -1 }); // latest first

      const result = await cursor.toArray();
      res.send(result);
    });
    // -------------riders related api----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
    // rider get
    app.get("/riders", async (req, res) => {
      const query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = ridersCollection.find(query).sort({ createAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });
    // rider post
    app.post("/riders", async (req, res) => {
      const rider = req.body;
      rider.status = "panding";
      rider.createAt = new Date();
      const result = await ridersCollection.insertOne(rider);
      res.send(result);
    });
    // rider patch
    app.patch(
      "/riders/:id",
      verfiyFBToken,
      veryfiyAdminToken,
      async (req, res) => {
        const status = req.body.status;
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status: status,
          },
        };
        const result = await ridersCollection.updateOne(query, updateDoc);
        if (status === "approved") {
          const email = req.body.email;
          const userQuery = { email };
          const updateUser = {
            $set: {
              role: "rider",
            },
          };
          const userResult = await userCollection.updateOne(
            userQuery,
            updateUser,
          );
          console.log("USER RESULT:", userResult);
        }
        res.send(result);
      },
    );

    // rider delete
    app.delete("/riders/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ridersCollection.deleteOne(query);
      res.send(result);
    });
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// test route
app.get("/", (req, res) => {
  res.send("ZapShip Server Running");
});

// server start
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
