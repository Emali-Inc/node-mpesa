// Creating Express server
const express = require("express");
const app = express();
const axios = require("axios");
const mongoose = require('mongoose');
const moment = require("moment");
const cors = require("cors");
const fs = require("fs");
const Payment = require("./models/paymentModel");
require("dotenv").config();

const port = process.env.PORT;

app.listen(port, () => {
  console.log(`App is running on localhost:${port}`);
});

mongoose.connect(process.env.MONGO_URL)
.then(() => {
  console.log('database connected successfully.');
})
.catch((err) => {
  console.log(err.message);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Creating the route
app.get('/', (req, res) => {
  res.send("<h1>Hello OuterRing</h1>");
});

// Middleware to generate token
const generateToken = async (req, res, next) => {
  const secret = process.env.MPESA_CONSUMER_SECRET;
  const consumer = process.env.MPESA_CONSUMER_KEY;

  const auth = Buffer.from(`${consumer}:${secret}`).toString("base64");

  try {
    const response = await axios.get("https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials", {
      headers: {
        Authorization: `Basic ${auth}`, // Corrected header format
      },
    });
    req.token = response.data.access_token; // Store the token in the request object
    next();
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
};

// Get Token Route
app.get("/token", generateToken, (req, res) => {
  res.send(`😀 Your access token is ${req.token}`);
});

// Pass the middleware before calling the STK push
app.post("/stk", generateToken, async (req, res) => {
  const phone = req.body.phone.substring(1); // Ensure you pass the phone number correctly
  const amount = req.body.amount;

  const timestamp = moment().format("YYYYMMDDHHmmss");

  const shortcode = process.env.MPESA_PAYBILL;
  const passkey = process.env.MPESA_PASSKEY;

  const password = Buffer.from(shortcode + passkey + timestamp).toString("base64");

  try {
    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      {
        BusinessShortCode: process.env.MPESA_PAYBILL,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount, // Use the amount from the request body
        PartyA: `254${phone}`, // Phone number to receive the STK push
        PartyB: shortcode,
        PhoneNumber: `254${phone}`,
        CallBackURL: "https://fa2d-41-212-56-196.ngrok-free.app/callback",
        AccountReference: `254${phone}`, // Account Reference or account number
        TransactionDesc: "Mpesa Daraja API STK push test",
      },
      {
        headers: {
          Authorization: `Bearer ${req.token}`, // Use the token from the request object
        },
      }
    );
    console.log(response.data);
    res.status(200).json(response.data);
  } catch (err) {
    console.error(err.message);
    res.status(400).json({ message: err.message });
  }
});

// Creating a callback URL
app.post("/callback", (req, res) => {
  const callbackData = req.body;

  // Log the entire callback data for debugging
  console.log("Received Callback Data:", JSON.stringify(callbackData, null, 2));

  // Check if callbackData has the expected structure
  if (callbackData && callbackData.Body && callbackData.Body.stkCallback) {
    const stkCallback = callbackData.Body.stkCallback;
    if (stkCallback.ResultCode === 0) {
      // Transaction successful
      if (stkCallback.CallbackMetadata) {
        console.log("Transaction successful:", stkCallback.CallbackMetadata);
        // Process successful transaction metadata
        // You can save transaction details to your database here
      } else {
        console.log("Callback metadata is not defined");
      }
    } else {
      // Transaction not successful (possibly canceled)
      console.log(`Transaction failed with ResultCode ${stkCallback.ResultCode}: ${stkCallback.ResultDesc}`);
      // Handle the transaction failure (log it, update database, notify user, etc.)
    }
  } else {
    console.log("Invalid callback data structure received");
    console.log("stkCallback is not defined in the received data");
  }

  res.json("Ok");

  //console.log(callbackData.Body.stkCallback.CallbackMetadata);

  const phone = callbackData.Body.stkCallback.CallbackMetadata.Item[4].value;
  const amount = callbackData.Body.stkCallback.CallbackMetadata.Item[0].value;
  const trnx_id = callbackData.Body.stkCallback.CallbackMetadata.Item[1].value;

  console.log({amount,phone,trnx_id})

  //Connecting to our Mongoo database
  const payment = new Payment();
  payment.number = phone;
  payment.amount = amount;
  payment.trnx_id = trnx_id;

  payment.save().then((data) => {
    console.log({message:"Saved successfully",data});
  }).catch((err) => {
    console.log(err.message)
  })
});
