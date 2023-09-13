// tested with Node-16

// read from .env
require('dotenv').config()

const fs = require('node:fs');
const axios = require('axios');
const { Blob } = require('node:buffer');
const debug = require('debug')('dda')
const { createHash } = require('node:crypto');

axios.defaults.baseURL = 'https://app.digital-downloads.com/api/v1/';
axios.defaults.headers.common = { Authorization: `Bearer ${process.env.ACCESS_TOKEN}` };

if (!process.env.ACCESS_TOKEN) {
  console.error('env var ACCESS_TOKEN was not provided')
  process.exit(1)
}

/**
 * Converts a Buffer to a Blob.
 * 
 * @param {Buffer} buffer the Buffer to convert
 * @returns {Blob} the converted Buffer as a Blob
 */
function buffer2blob(buffer) {
  if (buffer instanceof Buffer === false) {
    throw new Error('not an instance of a Buffer')
  }
  return new Blob([buffer])
}

/**
 * Converts a Blob to a Buffer.
 * 
 * @param {Blob} blob the Blob to convert
 * @returns {Buffer} the converted Blob as a Buffer
 */
async function blob2buffer(blob) {
  if (blob instanceof Blob === false) {
    throw new Error('not an instance of a Blob')
  }

  const arrayBuffer = await blob.arrayBuffer()
  return Buffer.from(arrayBuffer, 'binary')
}

/**
 * The current date, for an X-Amz-Date header.
 * 
 * @returns {Date} the date formatted for Amazon
 */
function amazonDate() {
  const now = new Date()
  return (
    now
      .toISOString()
      .split(':')
      .join('')
      .split('.')[0] + 'Z'
    )
    .split('-')
    .join('')
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
  const { name, size, mime, fileBlob } = fileMetadata;
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
      console.log('chunking part ', part.part)

      const blobBuffer = await blob2buffer(blob)
      const blobHash = createHash('sha256').update(blobBuffer).digest('hex')
      // these headers were recommended to be put in
      const putOptions = {
        headers: {
          'X-Amz-Content-Sha256': blobHash,
          'X-Amz-Date': amazonDate(),
          'X-Amz-Algorithm': 'AWS4-HMAC-SHA256'
        }
      }

      console.log('putHeaders', putOptions)

      promises.push(
          // send the PUT request to the url with part of the file
          // NOTE: this is the part that fails with 400 - InvalidRequest - Please use AWS4-HMAC-SHA256
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

const name = 'cat.jpg'
const fileBuffer = fs.readFileSync(name)
const fileBlob = buffer2blob(fileBuffer)
const size = fs.statSync(name).size
const mime = 'image/jpeg'

upload({ name, size, mime, fileBlob })
  .catch((e) => {
    console.error('!!!! general upload failure !!!!')
    console.error(e)
  })
