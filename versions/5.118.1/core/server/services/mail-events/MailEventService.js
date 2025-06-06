"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MailEventService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const errors_1 = __importDefault(require("@tryghost/errors"));
const tpl_1 = __importDefault(require("@tryghost/tpl"));
const MailEvent_1 = require("./MailEvent");
/**
 * @see https://documentation.mailgun.com/en/latest/user_manual.html#events-1
 */
var EventType;
(function (EventType) {
    EventType["CLICKED"] = "clicked";
    EventType["COMPLAINED"] = "complained";
    EventType["DELIVERED"] = "delivered";
    EventType["FAILED"] = "failed";
    EventType["OPENED"] = "opened";
    EventType["UNSUBSCRIBED"] = "unsubscribed";
})(EventType || (EventType = {}));
const VALIDATION_MESSAGES = {
    signingKeyNotConfigured: 'payload signing key is not configured',
    payloadSignatureMissing: 'Payload is missing "signature"',
    payloadSignatureInvalid: '"signature" is invalid',
    payloadEventsMissing: 'Payload is missing "mail_events"',
    payloadEventsInvalid: '"mail_events" is not an array',
    payloadEventKeyMissing: 'Event [{idx}] is missing "{key}"'
};
class MailEventService {
    mailEventRepository;
    config;
    labs;
    static LABS_KEY = 'mailEvents';
    static CONFIG_KEY_PAYLOAD_SIGNING_KEY = 'hostSettings:mailEventsPayloadSigningKey';
    constructor(mailEventRepository, config, labs) {
        this.mailEventRepository = mailEventRepository;
        this.config = config;
        this.labs = labs;
    }
    async processPayload(payload) {
        if (this.labs.isSet(MailEventService.LABS_KEY) === false) {
            throw new errors_1.default.NotFoundError();
        }
        const payloadSigningKey = this.config.get(MailEventService.CONFIG_KEY_PAYLOAD_SIGNING_KEY);
        // Verify that the service is configured correctly - We expect a string
        // for the payload signing key but as a safeguard we check the type here
        // to prevent any unexpected behaviour
        if (typeof payloadSigningKey !== 'string') {
            throw new errors_1.default.InternalServerError({
                message: (0, tpl_1.default)(VALIDATION_MESSAGES.signingKeyNotConfigured)
            });
        }
        // Verify the payload
        this.verifyPayload(payload, payloadSigningKey);
        // Store known events
        const eventTypes = new Set(Object.values(EventType));
        for (const payloadEvent of payload.mail_events) {
            if (eventTypes.has(payloadEvent.event) === false) {
                continue;
            }
            try {
                await this.mailEventRepository.save(new MailEvent_1.MailEvent(payloadEvent.id, payloadEvent.event, payloadEvent.message.headers['message-id'], payloadEvent.recipient, payloadEvent.timestamp * 1000));
            }
            catch (err) {
                throw new errors_1.default.InternalServerError({
                    message: 'Event could not be stored',
                    err: err
                });
            }
        }
    }
    validatePayload(payload) {
        if (payload.signature === undefined) {
            throw new errors_1.default.ValidationError({
                message: (0, tpl_1.default)(VALIDATION_MESSAGES.payloadSignatureMissing)
            });
        }
        if (typeof payload.signature !== 'string') {
            throw new errors_1.default.ValidationError({
                message: (0, tpl_1.default)(VALIDATION_MESSAGES.payloadSignatureInvalid)
            });
        }
        if (payload.mail_events === undefined) {
            throw new errors_1.default.ValidationError({
                message: (0, tpl_1.default)(VALIDATION_MESSAGES.payloadEventsMissing)
            });
        }
        if (Array.isArray(payload.mail_events) === false) {
            throw new errors_1.default.ValidationError({
                message: (0, tpl_1.default)(VALIDATION_MESSAGES.payloadEventsInvalid)
            });
        }
        const expectedKeys = ['id', 'timestamp', 'event', 'message', 'recipient'];
        payload.mail_events.forEach((payloadEvent, idx) => {
            expectedKeys.forEach((key) => {
                if (payloadEvent[key] === undefined) {
                    throw new errors_1.default.ValidationError({
                        message: (0, tpl_1.default)(VALIDATION_MESSAGES.payloadEventKeyMissing, { idx, key })
                    });
                }
                if (key === 'message' && payloadEvent.message.headers?.['message-id'] === undefined) {
                    throw new errors_1.default.ValidationError({
                        message: (0, tpl_1.default)(VALIDATION_MESSAGES.payloadEventKeyMissing, { idx, key: 'message.headers.message-id' })
                    });
                }
            });
        });
    }
    verifyPayload(payload, payloadSigningKey) {
        const data = JSON.stringify(payload.mail_events);
        const signature = crypto_1.default
            .createHmac('sha256', payloadSigningKey)
            .update(data)
            .digest('hex');
        if (signature !== payload.signature) {
            throw new errors_1.default.UnauthorizedError({
                message: (0, tpl_1.default)(VALIDATION_MESSAGES.payloadSignatureInvalid)
            });
        }
    }
}
exports.MailEventService = MailEventService;
