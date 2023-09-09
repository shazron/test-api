// tested with Node-16

// read from .env
require('dotenv').config()

const fs = require('node:fs');
const axios = require('axios');
const { Blob } = require('node:buffer');
const debug = require('debug')('dda')

axios.defaults.baseURL = 'https://app.digital-downloads.com/api/v1/';
axios.defaults.headers.common = { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` };

if (!process.env.ACCESS_TOKEN) {
  console.error('env var ACCESS_TOKEN was not provided')
  process.exit(1)
}

/**
 * Upload the file.
 *
 * @param {object} FileMetadata
 * @param {string} FileMetadata.name the name of the file
 * @param {number} FileMetadata.size the size of the file (bytes)
 * @param {string} FileMetadata.mime the mime-type of the file
 * @param {Blob} FileMetadata.file the file as a Blob
 * 
 */
async function upload(fileMetadata) {
  const { name, size, mime, file: fileBlob } = fileMetadata;
  // generate the signed urls
  const signedResponse = await axios
    .post('https://app.digital-downloads.com/api/v1/assets/signed', { 
        name,
        size,
        mime 
    })
    .then((r) => r.data);

  debug('signedResponse', signedResponse)

  // create a new http request and remove the content type
  const a = axios.create();
  delete a.defaults.headers.put['Content-Type'];

  const promises = [];

  for (const part of signedResponse.urls) {
      // get the part of the file to send in this request
      const blob = fileBlob.slice(part.start, part.end);

      debug('start', part.start, 'end', part.end, 'url', part.url);
      const putOptions = {
        headers: {
          'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
          'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
          'X-Amz-Date': (new Date().toISOString().split(':').join('').split('.')[0] + 'Z').split('-').join('')
        }
      }

      console.log('chunking part ', part.part)
      promises.push(
          // send the PUT request to the url with part of the file
          // NOTE: this is the part that fails with 400 - Missing x-amz-content-sha256
          a.put(part.url, blob, putOptions)
            .then((response) => {
              // from the header we need to etag, this is S3's id for each part
              // of file so we can re construct it when all pieces are uploaded
              const ret = {
                  ETag: response.headers.etag.split('"').join(''),
                  PartNumber: part.part,
              };
              debug('ETag', ret)
              return ret;
            })
      );
  }

  // once all parts have uploaded then we need to send 
  // the parts with the joined S3 etag back to the app
  debug('Sending all the promises...')
  Promise.all(promises)
    .then((parts) => {
      debug('all promises returned: ', JSON.stringify(parts, null, 2));
      return axios
        .post(`https://app.digital-downloads.com/api/v1/assets/${signedResponse.id}/uploaded`, { 
          parts, 
          upload_id: signedResponse.upload_id 
        })
        .then((r) => {
          console.log('Success: uploaded all parts to dda')
        });
    })
    .catch((e) => {
      console.error('!!!! One or more promise chunks failed !!!!')
      console.error(e)
    })
}

// ////////////////////////////////////////////////

const name = 'cat.jpg';
const file = new Blob([fs.readFileSync(name)]);
const size = fs.statSync(name).size;
const mime = 'image/jpeg';

upload({ name, size, mime, file })
  .catch((e) => {
    console.error('!!!! general upload failure !!!!')
    console.error(e)
  })
