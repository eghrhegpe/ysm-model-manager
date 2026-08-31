import { Endianness } from "./endianness";
/**
 * DataView wrapper for deserializing MMD data
 */
export class MmdDataDeserializer extends Endianness {
    _dataView;
    _decoder;
    _offset;
    /**
     * Creates MMD data deserializer
     * @param arrayBuffer ArrayBuffer to deserialize
     */
    constructor(arrayBuffer) {
        super();
        this._dataView = new DataView(arrayBuffer);
        this._decoder = null;
        this._offset = 0;
    }
    /**
     * Current offset in the buffer
     */
    get offset() {
        return this._offset;
    }
    set offset(value) {
        this._offset = value;
    }
    /**
     * Read a uint8 value
     * @returns Uint8 value
     */
    getUint8() {
        const value = this._dataView.getUint8(this._offset);
        this._offset += 1;
        return value;
    }
    /**
     * Read a int8 value
     * @returns Int8 value
     */
    getInt8() {
        const value = this._dataView.getInt8(this._offset);
        this._offset += 1;
        return value;
    }
    /**
     * Read a uint16 value
     * @returns Uint16 value
     */
    getUint16() {
        const value = this._dataView.getUint16(this._offset, true);
        this._offset += 2;
        return value;
    }
    /**
     * Read a uint16 array
     * @param dest Destination array
     */
    getUint16Array(dest) {
        const source = new Uint8Array(this._dataView.buffer, this._offset, dest.byteLength);
        new Uint8Array(dest.buffer, dest.byteOffset, dest.byteLength).set(source);
        this._offset += dest.byteLength;
        if (!this.isDeviceLittleEndian)
            this.swap16Array(dest);
    }
    /**
     * Read a int16 value
     * @returns Int16 value
     */
    getInt16() {
        const value = this._dataView.getInt16(this._offset, true);
        this._offset += 2;
        return value;
    }
    /**
     * Read a uint32 value
     * @returns Uint32 value
     */
    getUint32() {
        const value = this._dataView.getUint32(this._offset, true);
        this._offset += 4;
        return value;
    }
    /**
     * Read a int32 value
     * @returns Int32 value
     */
    getInt32() {
        const value = this._dataView.getInt32(this._offset, true);
        this._offset += 4;
        return value;
    }
    /**
     * Read a float32 value
     * @returns Float32 value
     */
    getFloat32() {
        const value = this._dataView.getFloat32(this._offset, true);
        this._offset += 4;
        return value;
    }
    /**
     * Read a float32 tuple
     * @param length Tuple length
     * @returns Float32 tuple
     */
    getFloat32Tuple(length) {
        const result = new Array(length);
        for (let i = 0; i < length; ++i) {
            result[i] = this._dataView.getFloat32(this._offset, true);
            this._offset += 4;
        }
        return result;
    }
    /**
     * Initializes TextDecoder with the specified encoding
     * @param encoding Encoding
     */
    initializeTextDecoder(encoding) {
        this._decoder = new TextDecoder(encoding);
    }
    /**
     * Decode the string in the encoding determined by the initializeTextDecoder method
     * @param length Length of the string in bytes
     * @param trim Whether to trim the string, usally used in Shift-JIS encoding
     * @returns Decoded string
     */
    getDecoderString(length, trim) {
        if (this._decoder === null) {
            throw new Error("TextDecoder is not initialized.");
        }
        let bytes = new Uint8Array(this._dataView.buffer, this._offset, length);
        this._offset += length;
        if (trim) {
            for (let i = 0; i < bytes.length; ++i) {
                if (bytes[i] === 0) {
                    bytes = bytes.subarray(0, i);
                    break;
                }
            }
        }
        return this._decoder.decode(bytes);
    }
    /**
     * Read a utf-8 string
     * @param length Length of the string in bytes
     * @returns Utf-8 string
     */
    getSignatureString(length) {
        const decoder = new TextDecoder("utf-8");
        const bytes = new Uint8Array(this._dataView.buffer, this._offset, length);
        this._offset += length;
        return decoder.decode(bytes);
    }
    /**
     * The number of bytes available
     */
    get bytesAvailable() {
        return this._dataView.byteLength - this._offset;
    }
}
