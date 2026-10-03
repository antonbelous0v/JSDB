#include "runtime.h"

#include "host.h"
#include "module_loader.h"

#include <iostream>
#include <stdexcept>

namespace mydb {

namespace {
void print(const v8::FunctionCallbackInfo<v8::Value>& info) {
    for (int i = 0; i < info.Length(); ++i) {
        v8::String::Utf8Value value(info.GetIsolate(), info[i]);
        if (i) std::cout << ' ';
        std::cout << (*value ? *value : "");
    }
    std::cout << '\n';
}
}

Runtime::Runtime(std::string executable, std::string js_root, std::vector<std::string> arguments)
    : executable_(std::move(executable)), js_root_(std::move(js_root)), arguments_(std::move(arguments)) {
    v8::V8::InitializeICUDefaultLocation(executable_.c_str());
    v8::V8::InitializeExternalStartupData(executable_.c_str());
    platform_ = v8::platform::NewDefaultPlatform();
    v8::V8::InitializePlatform(platform_.get());
    v8::V8::Initialize();
    allocator_ = v8::ArrayBuffer::Allocator::NewDefaultAllocator();
    v8::Isolate::CreateParams params;
    params.array_buffer_allocator = allocator_;
    isolate_ = v8::Isolate::New(params);
}

Runtime::~Runtime() {
    isolate_->Dispose();
    delete allocator_;
    v8::V8::Dispose();
    v8::V8::DisposePlatform();
}

int Runtime::run(const std::string& entry) {
    v8::Isolate::Scope isolate_scope(isolate_);
    v8::HandleScope handles(isolate_);
    auto global = v8::ObjectTemplate::New(isolate_);
    global->Set(isolate_, "print", v8::FunctionTemplate::New(isolate_, print));
    auto context = v8::Context::New(isolate_, nullptr, global);
    v8::Context::Scope context_scope(context);
    auto host = v8::Object::New(isolate_);
    install_fs(isolate_, host);
    install_memory(isolate_, host);
    install_net(isolate_, host);
    install_runtime(isolate_, host);
    install_time(isolate_, host);
    install_process(isolate_, host, arguments_);
    install_logging(isolate_, host);
    install_debug(isolate_, host);
    context->Global()->Set(context, v8::String::NewFromUtf8Literal(isolate_, "Host"), host).Check();
    ModuleLoader loader(isolate_, js_root_);
    v8::TryCatch errors(isolate_);
    auto module = loader.load(context, entry).ToLocalChecked();
    if (module->InstantiateModule(context, ModuleLoader::resolve).IsNothing()) throw std::runtime_error("Module instantiation failed");
    v8::Local<v8::Value> evaluation;
    if (!module->Evaluate(context).ToLocal(&evaluation)) {
        v8::String::Utf8Value message(isolate_, errors.Exception());
        throw std::runtime_error(*message ? *message : "JavaScript execution failed");
    }
    while (v8::platform::PumpMessageLoop(platform_.get(), isolate_)) {}
    isolate_->PerformMicrotaskCheckpoint();
    auto promise = evaluation.As<v8::Promise>();
    if (promise->State() == v8::Promise::kRejected) {
        v8::String::Utf8Value message(isolate_, promise->Result());
        throw std::runtime_error(*message ? *message : "JavaScript promise rejected");
    }
    return 0;
}

}
