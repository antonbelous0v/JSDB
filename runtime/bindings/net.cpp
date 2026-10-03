#include "host.h"

#include <cerrno>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <vector>
#if defined(_WIN32)
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#include <fcntl.h>
#endif

namespace mydb {

namespace {
#if defined(_WIN32)
using socket_handle = SOCKET;
constexpr socket_handle invalid_socket = INVALID_SOCKET;
int close_socket(socket_handle socket) { return closesocket(socket); }
#else
using socket_handle = int;
constexpr socket_handle invalid_socket = -1;
int close_socket(socket_handle socket) { return ::close(socket); }
#endif

std::string text(v8::Isolate* isolate, v8::Local<v8::Value> value) {
    v8::String::Utf8Value result(isolate, value);
    return *result ? *result : "";
}

void fail(v8::Isolate* isolate, const char* message) {
    isolate->ThrowException(v8::Exception::Error(v8::String::NewFromUtf8(isolate, message).ToLocalChecked()));
}

void method(v8::Isolate* isolate, v8::Local<v8::Object> object, const char* name, v8::FunctionCallback callback) {
    auto context = isolate->GetCurrentContext();
    object->Set(context, v8::String::NewFromUtf8(isolate, name).ToLocalChecked(), v8::Function::New(context, callback).ToLocalChecked()).Check();
}

void listen_socket(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto isolate = info.GetIsolate();
    auto host = text(isolate, info[0]);
    auto port = info[1]->Uint32Value(isolate->GetCurrentContext()).FromMaybe(0);
    auto socket = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (socket == invalid_socket) return fail(isolate, "socket failed");
    int enabled = 1;
    setsockopt(socket, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&enabled), sizeof(enabled));
    sockaddr_in address {};
    address.sin_family = AF_INET;
    address.sin_port = htons(static_cast<std::uint16_t>(port));
    if (inet_pton(AF_INET, host.c_str(), &address.sin_addr) != 1 || bind(socket, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0 || ::listen(socket, 16) < 0) {
        close_socket(socket);
        return fail(isolate, "listen failed");
    }
    info.GetReturnValue().Set(v8::BigInt::NewFromUnsigned(isolate, static_cast<std::uint64_t>(socket)));
}

socket_handle handle(v8::Local<v8::Value> value) {
    bool lossless = false;
    return static_cast<socket_handle>(value.As<v8::BigInt>()->Uint64Value(&lossless));
}

void accept_socket(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto socket = ::accept(handle(info[0]), nullptr, nullptr);
    if (socket == invalid_socket) return fail(info.GetIsolate(), "accept failed");
#if defined(__APPLE__)
    int enabled = 1;
    setsockopt(socket, SOL_SOCKET, SO_NOSIGPIPE, &enabled, sizeof(enabled));
#endif
    info.GetReturnValue().Set(v8::BigInt::NewFromUnsigned(info.GetIsolate(), static_cast<std::uint64_t>(socket)));
}

void read_socket(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto isolate = info.GetIsolate();
    auto capacity = info[1]->Uint32Value(isolate->GetCurrentContext()).FromMaybe(0);
    auto store = v8::ArrayBuffer::NewBackingStore(isolate, capacity);
    auto received = recv(handle(info[0]), static_cast<char*>(store->Data()), static_cast<int>(capacity), 0);
    if (received < 0) {
#if defined(_WIN32)
        if (WSAGetLastError() == WSAEWOULDBLOCK) return info.GetReturnValue().Set(v8::Null(isolate));
#else
        if (errno == EAGAIN || errno == EWOULDBLOCK) return info.GetReturnValue().Set(v8::Null(isolate));
#endif
        return fail(isolate, "read failed");
    }
    auto buffer = v8::ArrayBuffer::New(isolate, std::move(store));
    info.GetReturnValue().Set(v8::Uint8Array::New(buffer, 0, static_cast<std::size_t>(received)));
}

void set_nonblocking_socket(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto socket = handle(info[0]);
#if defined(_WIN32)
    u_long enabled = 1;
    if (ioctlsocket(socket, FIONBIO, &enabled) != 0) fail(info.GetIsolate(), "nonblocking failed");
#else
    auto flags = fcntl(socket, F_GETFL, 0);
    if (flags < 0 || fcntl(socket, F_SETFL, flags | O_NONBLOCK) < 0) fail(info.GetIsolate(), "nonblocking failed");
#endif
}

void poll_sockets(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto isolate = info.GetIsolate();
    auto context = isolate->GetCurrentContext();
    auto input = info[0].As<v8::Array>();
    fd_set reads;
    FD_ZERO(&reads);
    socket_handle maximum = 0;
    for (std::uint32_t index = 0; index < input->Length(); index += 1) {
        auto socket = handle(input->Get(context, index).ToLocalChecked());
        FD_SET(socket, &reads);
        if (socket > maximum) maximum = socket;
    }
    auto milliseconds = info[1]->Uint32Value(context).FromMaybe(0);
    timeval timeout {};
    timeout.tv_sec = milliseconds / 1000;
    timeout.tv_usec = (milliseconds % 1000) * 1000;
    auto ready = select(static_cast<int>(maximum + 1), &reads, nullptr, nullptr, &timeout);
    if (ready < 0) return fail(isolate, "poll failed");
    auto output = v8::Array::New(isolate);
    std::uint32_t offset = 0;
    for (std::uint32_t index = 0; index < input->Length(); index += 1) {
        auto value = input->Get(context, index).ToLocalChecked();
        if (FD_ISSET(handle(value), &reads)) output->Set(context, offset++, value).Check();
    }
    info.GetReturnValue().Set(output);
}

void write_socket(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto isolate = info.GetIsolate();
    auto view = info[1].As<v8::ArrayBufferView>();
    auto store = view->Buffer()->GetBackingStore();
    auto data = static_cast<const char*>(store->Data()) + view->ByteOffset();
    auto remaining = view->ByteLength();
    while (remaining > 0) {
#if defined(MSG_NOSIGNAL)
        auto written = send(handle(info[0]), data, static_cast<int>(remaining), MSG_NOSIGNAL);
#else
        auto written = send(handle(info[0]), data, static_cast<int>(remaining), 0);
#endif
        if (written <= 0) return fail(isolate, "write failed");
        data += written;
        remaining -= static_cast<std::size_t>(written);
    }
}

void close_socket_binding(const v8::FunctionCallbackInfo<v8::Value>& info) {
    if (close_socket(handle(info[0])) < 0) fail(info.GetIsolate(), "close failed");
}
}

void install_net(v8::Isolate* isolate, v8::Local<v8::Object> host) {
#if defined(_WIN32)
    WSADATA data {};
    if (WSAStartup(MAKEWORD(2, 2), &data) != 0) throw std::runtime_error("WSAStartup failed");
#endif
    auto context = isolate->GetCurrentContext();
    auto net = v8::Object::New(isolate);
    method(isolate, net, "listen", listen_socket);
    method(isolate, net, "accept", accept_socket);
    method(isolate, net, "read", read_socket);
    method(isolate, net, "write", write_socket);
    method(isolate, net, "close", close_socket_binding);
    method(isolate, net, "setNonblocking", set_nonblocking_socket);
    method(isolate, net, "poll", poll_sockets);
    host->Set(context, v8::String::NewFromUtf8Literal(isolate, "net"), net).Check();
}

}
