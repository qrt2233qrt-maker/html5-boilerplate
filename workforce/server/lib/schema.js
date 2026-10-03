// Shorthands for Fastify JSON schemas. Every object rejects unknown keys.
export const str = (max = 200, min = 1) => ({ type: 'string', minLength: min, maxLength: max });
export const optStr = (max = 200) => ({ type: ['string', 'null'], maxLength: max });
export const int = (min = 0, max = Number.MAX_SAFE_INTEGER) => ({ type: 'integer', minimum: min, maximum: max });
export const money = { type: 'integer', minimum: 1, maximum: 1e15 };
export const signedMoney = { type: 'integer', minimum: -1e15, maximum: 1e15 };
export const uuid = { type: 'string', format: 'uuid' };
export const optUuid = { type: ['string', 'null'], format: 'uuid' };
export const date = { type: 'string', format: 'date' };
export const optDate = { type: ['string', 'null'], format: 'date' };
export const datetime = { type: 'string', format: 'date-time' };
export const bool = { type: 'boolean' };
export const oneOf = (...values) => ({ enum: values });
export const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
export const arr = (items, max = 500) => ({ type: 'array', items, maxItems: max });
export const params = (extra = {}) => ({ type: 'object', properties: { businessId: uuid, ...extra } });
export const idParams = params({ id: uuid });
export const range = { from: date, to: date };
export const page = { limit: int(1, 200), cursor: str(300), offset: int(0, 1e6) };
