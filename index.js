var express = require('express');
var axios = require('axios');
var bodyParser = require('body-parser');
var ejs = require('ejs');
var helmet = require('helmet');
var compression = require('compression');
var winston = require('winston');
var cors = require('cors');
var RateLimit = require('express-rate-limit');

var app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
app.set('view engine','ejs');
app.use(express.static('views'));
app.use(cors({origin: [
  'https://merry-weather-test.netlify.app',
  'http://localhost:3000',
  'http://192.168.43.198:3000',
  process.env.SITE
]}));
app.use(compression());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      frameAncestors: ["http://localhost:3000","https://merry-weather-test.netlify.app"]
    }
  },
  frameguard: false,
}));

var apiLimiter = new RateLimit({
  windowMs: 60 * 1000,
  max: 20,
});

var logger = winston.createLogger({
  transports: [
    new winston.transports.Console(),
  ]
});

app.use(apiLimiter);

  app.get('/mapshow/minimap', (req,res) => {
  if(req.query['placeName']) {
    //Initial request for geocoding
    axios.get('https://nominatim.openstreetmap.org/search?q=' + req.query['placeName'] + '&format=geocodejson&limit=1')
    .then((response) => {
      logger.log('info', 'New city Geocoding data received', {timestamp: Date.now(), pid: process.pid});
      let citycoords = {
        lat: response.data.features[0].geometry.coordinates[1],
        long: response.data.features[0].geometry.coordinates[0],
        placeName: response.data.features[0].properties.geocoding.name,
        placeLabel: response.data.features[0].properties.geocoding.label,
        placeType: response.data.features[0].properties.geocoding.type
      };
      logger.log('info', 'Lat:' +citycoords.lat+ 'Long:' + citycoords.long, {timestamp: Date.now(), pid: process.pid});
      if(citycoords.lat !== undefined && citycoords.long !== undefined) {     
        axios.get('https://api.darksky.net/forecast/' + process.env.API_KEY + '/' + citycoords.lat + ',' + citycoords.long)
        .then((resp) => {
          console.log(citycoords.placeName + 'is here');
          console.log(typeof(citycoords.placeName));
          let temp = (Math.round(50/9*(resp.data.currently.temperature -32))/10)
          var success = ejs.renderFile('./views/mapquest.ejs', 
          { lat: citycoords.lat, 
            cityname: `"${citycoords.placeName}"`,
            temp: temp,
            long: citycoords.long
          }
          );
          success.then((data) => {
            console.log(resp.data.currently.temperature);
            res.send(data);
          });
        })
        .catch((err) => {
          console.log(err);
          if(err.errno === 'ENOTFOUND') {
            var str = ejs.renderFile('./views/simple.ejs');
            str.then((data) => {
              res.send(data);
            });  
          }
          return err;
        });
      }
      
    }).catch((err) => {
      console.log(err);
      logger.log('info', err, {timestamp: Date.now(), pid: process.pid});
      logger.log('info', 'Name is ' + err.errno, {timestamp: Date.now(), pid: process.pid});
      var str = ejs.renderFile('./views/simple.ejs');
      str.then((data) => {
        res.send(data);
      }); 
    });
}});

app.get('/darksky', (req,res) => {
  logger.log('info', 'Post request received', {timestamp: Date.now(), pid: process.pid, route:'/darksky'});
  axios.get('https://api.darksky.net/forecast/' + process.env.API_KEY +' /29,75')
  .then((response) => {
    res.json(response.data);
  })
  .catch((err) => {
    logger.log('info', err, {timestamp: Date.now(), pid: process.pid, route:'/darksky'});
  });
});

// Main (after initial location)
app.get('/initial', (req,res) => {
  // Initially using Reverse Geocoding api to find place of user (paid)
  // Now using Nominatin
  logger.log('info', 'City request received' + req.query['lat'] + req.query['long'], {timestamp: Date.now(), pid: process.pid, route: '/initial'});
  if(req.query['lat'] && req.query['long']) {
    axios.all([
      axios.get('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + req.query['lat'] + '&lon=' + req.query['long']),
      axios.get('https://api.darksky.net/forecast/' + process.env.API_KEY + '/' + req.query['lat'] + ',' + req.query['long'])
    ])
    .then((respArr) => {
      res.json({ 
        weather: respArr[1].data, 
        geocode: {
          lat: req.query['lat'],
          long: req.query['long'],
          placeName: respArr[0].data.address.city,
        } });
    }).catch((err) => {
      logger.log('info', err, {timestamp: Date.now(), pid: process.pid, route:'/initial'});
      console.log(err);
      return err;
    });
  } else {
    logger.log('info', 'No lat or long in req header', {timestamp: Date.now(), pid: process.pid, route:'/initial'});
    let error = new Error('No lat or long in request header');
    res.send(error);
  }
});

// Main (after entering in SearchBar)
app.get('/changeplace', (req,res) => {
  console.log(JSON.stringify(req.headers.origin));
  if(req.query['place']) {
    //Initial request for geocoding
    axios.get('https://nominatim.openstreetmap.org/search?q=' + req.query['place'] + '&format=geocodejson&limit=1')
    .then((response) => {
      console.log('New city Geocoding data received');
      if(Object.keys(response.data.features).length === 0) {
        // (&& response.data.features.constructor === Object)
        console.log(Object.keys(response.data.features).length);
        let error = new Error('Name is not valid');   
        res.send(error);
      } else {
        let citycoords = {
          lat: response.data.features[0].geometry.coordinates[1],
          long: response.data.features[0].geometry.coordinates[0],
          placeName: response.data.features[0].properties.geocoding.name,
          placeLabel: response.data.features[0].properties.geocoding.label,
          placeType: response.data.features[0].properties.geocoding.type
        };
        console.log('Lat:' +citycoords.lat+ 'Long:' + citycoords.long);

        // Second request to dark sky if citycoords are not undefined
        if(citycoords.lat !== undefined) {     
          axios.get('https://api.darksky.net/forecast/' + process.env.API_KEY + '/' + citycoords.lat + ',' + citycoords.long)
          .then((resp) => {
            res.json({ weather: resp.data, geocode: citycoords });
          })
          .catch((err) => {
            console.log(err);
          });
        } else {
          console.log('error in geocode request');
        }
      }
      
    }).catch((err) => {
      console.log(err);
      res.send('<h2>Place not found</h2>')
    })

  } else {
    let errr = new Error('Place not found in params');
    res.send(errr);
  }
});

// Change to http if req.socket aint available and rateLimiter doesnt work correctly
app.listen(process.env.PORT || 5000, (req,res) => {
  console.log("Server running on port 5000");
});