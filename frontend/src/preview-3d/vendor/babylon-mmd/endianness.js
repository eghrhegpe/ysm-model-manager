/**
 * Endianness utility class for serlization/deserialization
 */
export class Endianness {
    /**
     * Whether the device is little endian
     */
    isDeviceLittleEndian;
    constructor() {
        this.isDeviceLittleEndian = this._getIsDeviceLittleEndian();
    }
    _getIsDeviceLittleEndian() {
        const array = new Int16Array([256]);
        return new Int8Array(array.buffer)[1] === 1;
    }
    /**
     * Changes the byte order of the array
     * @param array Array to swap
     */
    swap16Array(array, offset = 0, length = array.length) {
        for (let i = offset; i < length; ++i) {
            const value = array[i];
            array[i] = ((value & 0xFF) << 8) | ((value >> 8) & 0xFF);
        }
    }
    /**
     * Changes the byte order of the array
     * @param array Array to swap
     */
    swap32Array(array, offset = 0, length = array.length) {
        for (let i = offset; i < length; ++i) {
            const value = array[i];
            array[i] = ((value & 0xFF) << 24) | ((value & 0xFF00) << 8) | ((value >> 8) & 0xFF00) | ((value >> 24) & 0xFF);
        }
    }
}
