#pragma once

#include <string>
#include <vector>

#include <v8.h>

namespace mydb {

void install_fs(v8::Isolate* isolate, v8::Local<v8::Object> host);
void install_memory(v8::Isolate* isolate, v8::Local<v8::Object> host);
void install_net(v8::Isolate* isolate, v8::Local<v8::Object> host);
void install_runtime(v8::Isolate* isolate, v8::Local<v8::Object> host);
void install_time(v8::Isolate* isolate, v8::Local<v8::Object> host);
void install_process(v8::Isolate* isolate, v8::Local<v8::Object> host, const std::vector<std::string>& arguments);
void install_logging(v8::Isolate* isolate, v8::Local<v8::Object> host);
void install_debug(v8::Isolate* isolate, v8::Local<v8::Object> host);

}
