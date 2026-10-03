#include "host.h"

#include <cerrno>
#include <cstdint>
#include <cstring>
#include <fcntl.h>
#include <filesystem>
#include <stdexcept>
#if defined(_WIN32)
#include <io.h>
#include <sys/stat.h>
#include <windows.h>
#else
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace mydb {

namespace {
#if defined(_WIN32)
int system_open(const char* path, int flags) { return ::_open(path, flags | _O_BINARY, 0600); }
int system_close(int fd) { return ::_close(fd); }
std::int64_t system_pread(int fd, void* buffer, std::size_t length, std::int64_t offset) {
    OVERLAPPED operation {};
    operation.Offset = static_cast<DWORD>(offset);
    operation.OffsetHigh = static_cast<DWORD>(offset >> 32);
    DWORD transferred = 0;
    return ReadFile(reinterpret_cast<HANDLE>(::_get_osfhandle(fd)), buffer, static_cast<DWORD>(length), &transferred, &operation) ? transferred : -1;
}
std::int64_t system_pwrite(int fd, const void* buffer, std::size_t length, std::int64_t offset) {
    OVERLAPPED operation {};
    operation.Offset = static_cast<DWORD>(offset);
    operation.OffsetHigh = static_cast<DWORD>(offset >> 32);
    DWORD transferred = 0;
    return WriteFile(reinterpret_cast<HANDLE>(::_get_osfhandle(fd)), buffer, static_cast<DWORD>(length), &transferred, &operation) ? transferred : -1;
}
int system_sync(int fd) { return FlushFileBuffers(reinterpret_cast<HANDLE>(::_get_osfhandle(fd))) ? 0 : -1; }
int system_data_sync(int fd) { return system_sync(fd); }
int system_truncate(int fd, std::int64_t size) { return ::_chsize_s(fd, size); }
#if defined(__MINGW32__)
std::int64_t system_size(int fd) { struct ::_stati64 status {}; return ::_fstati64(fd, &status) < 0 ? -1 : status.st_size; }
#else
std::int64_t system_size(int fd) { struct ::_stat64 status {}; return ::_fstat64(fd, &status) < 0 ? -1 : status.st_size; }
#endif
int system_unlink(const char* path) { return ::_unlink(path); }
#else
int system_open(const char* path, int flags) { return ::open(path, flags, 0644); }
int system_close(int fd) { return ::close(fd); }
std::int64_t system_pread(int fd, void* buffer, std::size_t length, std::int64_t offset) { return ::pread(fd, buffer, length, offset); }
std::int64_t system_pwrite(int fd, const void* buffer, std::size_t length, std::int64_t offset) { return ::pwrite(fd, buffer, length, offset); }
int system_sync(int fd) { return ::fsync(fd); }
#if defined(__APPLE__)
int system_data_sync(int fd) { return ::fcntl(fd, F_FULLFSYNC); }
#else
int system_data_sync(int fd) { return ::fdatasync(fd); }
#endif
int system_truncate(int fd, std::int64_t size) { return ::ftruncate(fd, size); }
std::int64_t system_size(int fd) { struct stat status {}; return ::fstat(fd, &status) < 0 ? -1 : status.st_size; }
int system_unlink(const char* path) { return ::unlink(path); }
#endif

int system_lock_exclusive(int fd) {
#if defined(_WIN32)
    OVERLAPPED operation {};
    auto handle = reinterpret_cast<HANDLE>(::_get_osfhandle(fd));
    if (LockFileEx(handle, LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY, 0, MAXDWORD, MAXDWORD, &operation)) return 0;
    errno = EACCES;
    return -1;
#else
    return ::flock(fd, LOCK_EX | LOCK_NB);
#endif
}

std::string text(v8::Isolate* isolate, v8::Local<v8::Value> value) {
    v8::String::Utf8Value result(isolate, value);
    return *result ? *result : "";
}

void fail(v8::Isolate* isolate, const std::string& operation) {
    isolate->ThrowException(v8::Exception::Error(v8::String::NewFromUtf8(isolate, (operation + ": " + std::strerror(errno)).c_str()).ToLocalChecked()));
}

void method(v8::Isolate* isolate, v8::Local<v8::Object> object, const char* name, v8::FunctionCallback callback) {
    auto context = isolate->GetCurrentContext();
    object->Set(context, v8::String::NewFromUtf8(isolate, name).ToLocalChecked(), v8::Function::New(context, callback).ToLocalChecked()).Check();
}

void open_file(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto isolate = info.GetIsolate();
    auto path = text(isolate, info[0]);
    auto flags = info[1]->Int32Value(isolate->GetCurrentContext()).FromMaybe(0);
    auto fd = system_open(path.c_str(), flags);
    if (fd < 0) return fail(isolate, "open");
    info.GetReturnValue().Set(fd);
}

void close_file(const v8::FunctionCallbackInfo<v8::Value>& info) {
    if (system_close(info[0].As<v8::Int32>()->Value()) < 0) fail(info.GetIsolate(), "close");
}

void lock_file_exclusive(const v8::FunctionCallbackInfo<v8::Value>& info) {
    if (system_lock_exclusive(info[0].As<v8::Int32>()->Value()) < 0) fail(info.GetIsolate(), "lock");
}

void pread_file(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto isolate = info.GetIsolate();
    auto view = info[1].As<v8::ArrayBufferView>();
    auto store = view->Buffer()->GetBackingStore();
    auto offset = view->ByteOffset() + info[2]->IntegerValue(isolate->GetCurrentContext()).FromMaybe(0);
    auto length = info[3]->IntegerValue(isolate->GetCurrentContext()).FromMaybe(0);
    auto file_offset = info[4]->IntegerValue(isolate->GetCurrentContext()).FromMaybe(0);
    auto read = system_pread(info[0].As<v8::Int32>()->Value(), static_cast<char*>(store->Data()) + offset, length, file_offset);
    if (read < 0) return fail(isolate, "pread");
    info.GetReturnValue().Set(static_cast<double>(read));
}

void pwrite_file(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto isolate = info.GetIsolate();
    auto view = info[1].As<v8::ArrayBufferView>();
    auto store = view->Buffer()->GetBackingStore();
    auto offset = view->ByteOffset() + info[2]->IntegerValue(isolate->GetCurrentContext()).FromMaybe(0);
    auto length = info[3]->IntegerValue(isolate->GetCurrentContext()).FromMaybe(0);
    auto file_offset = info[4]->IntegerValue(isolate->GetCurrentContext()).FromMaybe(0);
    auto written = system_pwrite(info[0].As<v8::Int32>()->Value(), static_cast<char*>(store->Data()) + offset, length, file_offset);
    if (written < 0) return fail(isolate, "pwrite");
    info.GetReturnValue().Set(static_cast<double>(written));
}

void sync_file(const v8::FunctionCallbackInfo<v8::Value>& info) {
    if (system_sync(info[0].As<v8::Int32>()->Value()) < 0) fail(info.GetIsolate(), "fsync");
}

void data_sync_file(const v8::FunctionCallbackInfo<v8::Value>& info) {
    if (system_data_sync(info[0].As<v8::Int32>()->Value()) < 0) fail(info.GetIsolate(), "fdatasync");
}

void truncate_file(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto context = info.GetIsolate()->GetCurrentContext();
    if (system_truncate(info[0].As<v8::Int32>()->Value(), info[1]->IntegerValue(context).FromMaybe(0)) < 0) fail(info.GetIsolate(), "truncate");
}

void file_size(const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto size = system_size(info[0].As<v8::Int32>()->Value());
    if (size < 0) return fail(info.GetIsolate(), "size");
    info.GetReturnValue().Set(static_cast<double>(size));
}

void rename_file(const v8::FunctionCallbackInfo<v8::Value>& info) {
    if (::rename(text(info.GetIsolate(), info[0]).c_str(), text(info.GetIsolate(), info[1]).c_str()) < 0) fail(info.GetIsolate(), "rename");
}

void unlink_file(const v8::FunctionCallbackInfo<v8::Value>& info) {
    if (system_unlink(text(info.GetIsolate(), info[0]).c_str()) < 0) fail(info.GetIsolate(), "unlink");
}

void exists_file(const v8::FunctionCallbackInfo<v8::Value>& info) {
    info.GetReturnValue().Set(std::filesystem::exists(text(info.GetIsolate(), info[0])));
}

void make_directory(const v8::FunctionCallbackInfo<v8::Value>& info) {
    std::error_code error;
    auto created = std::filesystem::create_directories(text(info.GetIsolate(), info[0]), error);
    if (error) return fail(info.GetIsolate(), "mkdir");
    info.GetReturnValue().Set(created);
}
}

void install_fs(v8::Isolate* isolate, v8::Local<v8::Object> host) {
    auto context = isolate->GetCurrentContext();
    auto fs = v8::Object::New(isolate);
    method(isolate, fs, "open", open_file);
    method(isolate, fs, "close", close_file);
    method(isolate, fs, "lockExclusive", lock_file_exclusive);
    method(isolate, fs, "pread", pread_file);
    method(isolate, fs, "pwrite", pwrite_file);
    method(isolate, fs, "fsync", sync_file);
    method(isolate, fs, "fdatasync", data_sync_file);
    method(isolate, fs, "truncate", truncate_file);
    method(isolate, fs, "size", file_size);
    method(isolate, fs, "rename", rename_file);
    method(isolate, fs, "unlink", unlink_file);
    method(isolate, fs, "exists", exists_file);
    method(isolate, fs, "mkdir", make_directory);
    fs->Set(context, v8::String::NewFromUtf8Literal(isolate, "O_RDONLY"), v8::Integer::New(isolate, O_RDONLY)).Check();
    fs->Set(context, v8::String::NewFromUtf8Literal(isolate, "O_RDWR"), v8::Integer::New(isolate, O_RDWR)).Check();
    fs->Set(context, v8::String::NewFromUtf8Literal(isolate, "O_CREAT"), v8::Integer::New(isolate, O_CREAT)).Check();
    host->Set(context, v8::String::NewFromUtf8Literal(isolate, "fs"), fs).Check();
}

}
