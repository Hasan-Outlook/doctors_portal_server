const express = require('express');
const cors = require('cors');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)
// console.log(stripe);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send(`Server is runing on ${port}`);
})


// const uri = "mongodb://localhost:27017"


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.hhzfvfg.mongodb.net/?retryWrites=true&w=majority&appName=AtlasApp`;
console.log(uri);
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

function verifyJWT(req, res, next) {
  // console.log('token verifyJWT', req.headers.authorization);
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send('Unauthorized access');
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      res.status(403).send({ message: 'Forbidden access' })
    }
    req.decoded = decoded;
    next();
  })
}

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database = client.db("doctors_portal");
    const appointmentCollection = database.collection("appointmentTime");
    const bookingCollection = database.collection('appointmentBooking');
    const usersCollection = database.collection('users');
    const doctorsCollection = database.collection('doctors');

    // NOTE: Make sure you use verifyAdmin after verifyJWT
    const verifyAdmin = async (req, res, next) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);

      if (user?.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden access' });
      }
      next()
    }



    app.get('/appointmentOption', async (req, res) => {
      const date = req.query.date;
      const cursor = appointmentCollection.find();
      const results = await cursor.toArray()

      const bookingQuery = { selectedDate: date }
      const alreadyBooked = await bookingCollection.find(bookingQuery).toArray();

      results.forEach(result => {
        const optionBooked = alreadyBooked.filter(book => book.service === result.name)
        const bookedSlots = optionBooked.map(book => book.slot)

        const remainingSlots = result.slots.filter(slot => !bookedSlots.includes(slot))
        result.slots = remainingSlots;
        // console.log(result.name, remainingSlots.length);
      })

      res.send(results);
    })

    app.get('/doctorSpecialty', async (req, res) => {
      const query = {}
      const result = await appointmentCollection.find(query).project({ name: 1 }).toArray();
      res.send(result);
    })

    // Appointment Booking API 

    app.get('/appointmentBooking', async (req, res) => {
      const cursor = bookingCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    })

    app.get('/myAppointments', verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;

      if (email !== decodedEmail) {
        return res.status(403).send({ message: 'Forbidden access' })
      }

      const query = { email: email };
      const myAppointments = await bookingCollection.find(query).toArray();
      res.send(myAppointments);
    })

    app.get('/appointment/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const appointment = await bookingCollection.findOne(query);
      res.send(appointment);
    })

    app.post('/appointment', async (req, res) => {
      const booking = req.body;
      console.log(booking);
      const query = {
        selectedDate: booking.selectedDate,
        email: booking.email,
        service: booking.service,
      }
      const alreadyBooking = await bookingCollection.find(query).toArray();
      if (alreadyBooking.length) {
        const message = `You already have a booked on ${booking.selectedDate}`
        return res.send({ acknowledged: false, message })
      }

      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    });

    // PAYMENT API.
    app.post('/create-payment-intent', async (req, res) => {
      const appointment = req.body;
      const price = appointment.price;
      const amount = price * 100;

      const paymentIntent = await stripe.paymentIntent.create({
        currency: "usd",
        amount: amount,
        'payment_method_types': [
          'card'
        ]
      })
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    })

    // NOTE: Temporary to update price fild on appointmentcollection.

    // app.get('/addPrice', async(req, res) => {
    //   const query = {};
    //   const options = {upsert: true};
    //   const updatedDoc = {
    //     $set: {
    //       price: 100
    //     }
    //   }
    //   const result = await appointmentCollection.updateMany(query, updatedDoc, options);
    //   res.send(result);
    // })

    // JWT access token API

    app.get('/jwt', async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '2 days' })
        return res.send({ accessToken: token })
      }
      console.log(user);
      res.status(403).send({ accessToken: '' })
    });

    app.get('/users', async (req, res) => {
      const query = {};
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    })

    app.get('/users/admin/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === 'admin' });
    })

    app.post('/users', async (req, res) => {
      const user = req.body;
      console.log(user);
      const result = await usersCollection.insertOne(user);
      res.send(result);
    })

    app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await usersCollection.updateOne(filter, updatedDoc, options);
      res.send(result);
    })

    // Add Doctor API

    app.get('/dashbord/allDoctors', verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const result = await doctorsCollection.find(query).toArray();
      res.send(result);
    })

    app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result)
    })

    app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await doctorsCollection.deleteOne(query)
      res.send(result);
    })

  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.listen(port, () => {
  console.log('Server is running on port: ' + port);
});