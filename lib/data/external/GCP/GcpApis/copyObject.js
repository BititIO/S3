const async = require('async');
const request = require('request');
const { errors } = require('arsenal');

const { logger, JsonError } = require('../GcpUtils');
const { logHelper } = require('../../utils');
const GcpRequest = require('../GcpRequest');

/*
 * copyObject - minimum required functionality to perform object copy
 * for GCP Backend
 * @param {object} params - update metadata params
 * @param {string} params.Bucket - bucket name
 * @param {string} params.Key - object key
 * @param {string} param.CopySource - source object
 * @param {function} callback - callback function to call with the copy object
 * result
 * @return {undefined}
 */
function _copyObject(params, callback) {
    const { CopySource } = params;
    const sourceArray = CopySource.split('/');
    const sourceBucket = sourceArray[0] ? sourceArray[0] : sourceArray[1];
    const objectStart = sourceArray[0] ? 1 : 2;
    const sourceObject =
        sourceArray.slice(objectStart).reduce(
            (prev, curr) => {
                const ret = prev ? `${prev}/${curr}` : `${curr}`;
                return ret;
            }, '');
    async.waterfall([
        next => {
            this.getToken((err, res) => next(err, res));
        },
        (token, next) => {
            const uri = '/storage/v1' +
                        `/b/${encodeURIComponent(sourceBucket)}` +
                        `/o/${encodeURIComponent(sourceObject)}` +
                        '/copyTo' +
                        `/b/${encodeURIComponent(params.Bucket)}` +
                        `/o/${encodeURIComponent(params.Key)}`;
            request({
                method: 'POST',
                baseUrl: this.config.jsonEndpoint,
                uri,
                auth: { bearer: token } },
            (err, resp, body) => {
                if (err) {
                    logHelper(logger, 'error',
                        'copyObject: err in json method',
                        errors.InternalError.customizeDescription(
                            'json method copyObject failed'));
                    return next(errors.InternalError
                        .customizeDescription('err in JSON Request'));
                }
                if (resp.statusCode >= 300) {
                    return next(
                        new JsonError(resp.statusMessage, resp.statusCode));
                }
                let res;
                try {
                    res = body && typeof body === 'string' ?
                        JSON.parse(body) : body;
                } catch (error) { res = undefined; }
                if (res && res.error && res.error.code >= 300) {
                    return next(
                        new JsonError(res.error.message, res.error.code));
                }
                return next(null, res);
            });
        },
        (result, next) => {
            // if metadata directive is REPLACE then perform a metadata update
            // otherwise default to COPY
            if (params.MetadataDirective === 'REPLACE') {
                const updateParams = {
                    Bucket: params.Bucket,
                    Key: params.Key,
                    Metadata: params.Metadata || {},
                    VersionId: result.generation,
                };
                return this.updateMetadata(updateParams, (err, res) => {
                    if (err) {
                        return next(err);
                    }
                    const resObj = {
                        CopyObjectResult: {
                            ETag: res.etag,
                            LastModified: res.updated,
                        },
                        VersiondId: res.generation,
                    };
                    return next(null, resObj);
                });
            }
            const resObj = {
                CopyObjectResult: {
                    ETag: result.etag,
                    LastModified: result.updated,
                },
                VersiondId: result.generation,
            };
            return next('SkipMetadata', resObj);
        },
    ], (err, result) => {
        if (err) {
            if (err === 'SkipMetadata') {
                return callback(null, result);
            }
            return callback(err);
        }
        return callback(null, result);
    });
}

module.exports = function copyObject(params, callback) {
    const req = new GcpRequest(this, _copyObject, params);
    if (callback && typeof callback === 'function') {
        req.send(callback);
    }
    return req;
};
