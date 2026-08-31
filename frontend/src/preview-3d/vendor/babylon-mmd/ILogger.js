/**
 * A logger that outputs to the console
 *
 * generally, you can use this class as default logger
 */
export class ConsoleLogger {
    log(message) {
        console.log(message);
    }
    warn(message) {
        console.warn(message);
    }
    error(message) {
        console.error(message);
    }
}
