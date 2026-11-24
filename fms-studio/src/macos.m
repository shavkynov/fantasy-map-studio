#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#include <stdint.h>
#include <stddef.h>

typedef struct {
    uint16_t status;
    char *content_type;
    uint8_t *data;
    size_t len;
} FmsBuf;

extern FmsBuf fms_handle_request(const void *ctx, const char *target);
extern void fms_free_buf(FmsBuf buf);

@interface FmsSchemeHandler : NSObject <WKURLSchemeHandler>
@property(nonatomic, assign) const void *ctx;
@property(nonatomic, strong) NSMutableSet<NSValue *> *activeTasks;
- (instancetype)initWithCtx:(const void *)ctx;
@end

@implementation FmsSchemeHandler

- (instancetype)initWithCtx:(const void *)ctx {
    self = [super init];
    if (self) {
        _ctx = ctx;
        _activeTasks = [NSMutableSet set];
    }
    return self;
}

- (void)webView:(WKWebView *)webView startURLSchemeTask:(id<WKURLSchemeTask>)urlSchemeTask {
    (void)webView;
    NSValue *key = [NSValue valueWithPointer:(__bridge const void *)urlSchemeTask];
    @synchronized(self) {
        [self.activeTasks addObject:key];
    }

    NSURL *url = urlSchemeTask.request.URL;
    NSURLComponents *comp = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
    NSString *path = comp.percentEncodedPath.length > 0 ? comp.percentEncodedPath : @"/";
    NSString *target = comp.percentEncodedQuery.length > 0
        ? [NSString stringWithFormat:@"%@?%@", path, comp.percentEncodedQuery]
        : path;

    const void *ctx = self.ctx;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        FmsBuf buf = fms_handle_request(ctx, [target UTF8String]);
        NSInteger status = (NSInteger)buf.status;
        NSString *ctype = buf.content_type
            ? [NSString stringWithUTF8String:buf.content_type]
            : @"application/octet-stream";
        NSData *body = (buf.data && buf.len > 0)
            ? [NSData dataWithBytes:buf.data length:buf.len]
            : [NSData data];
        fms_free_buf(buf);

        dispatch_async(dispatch_get_main_queue(), ^{
            BOOL alive = NO;
            @synchronized(self) {
                alive = [self.activeTasks containsObject:key];
                [self.activeTasks removeObject:key];
            }
            if (!alive) {
                return;
            }
            NSDictionary *headers = @{
                @"Content-Type": ctype,
                @"Content-Length": [NSString stringWithFormat:@"%lu", (unsigned long)body.length],
                @"Cache-Control": @"no-store",
            };
            NSHTTPURLResponse *resp = [[NSHTTPURLResponse alloc] initWithURL:url
                                                                  statusCode:status
                                                                 HTTPVersion:@"HTTP/1.1"
                                                                headerFields:headers];
            [urlSchemeTask didReceiveResponse:resp];
            if (body.length > 0) {
                [urlSchemeTask didReceiveData:body];
            }
            [urlSchemeTask didFinish];
        });
    });
}

- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)urlSchemeTask {
    (void)webView;
    NSValue *key = [NSValue valueWithPointer:(__bridge const void *)urlSchemeTask];
    @synchronized(self) {
        [self.activeTasks removeObject:key];
    }
}

@end

@interface FmsAppDelegate : NSObject <NSApplicationDelegate, WKScriptMessageHandler>
@property(nonatomic, assign) const void *ctx;
@property(nonatomic, copy) NSString *appTitle;
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) FmsSchemeHandler *schemeHandler;
@end

@implementation FmsAppDelegate

- (void)setupMenus {
    NSMenu *menubar = [[NSMenu alloc] init];
    NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:appMenuItem];

    NSMenu *appMenu = [[NSMenu alloc] init];
    NSString *title = self.appTitle ?: @"Fantasy Map Studio";
    [appMenu addItemWithTitle:[NSString stringWithFormat:@"Скрыть %@", title]
                       action:@selector(hide:)
                keyEquivalent:@"h"];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:[NSString stringWithFormat:@"Выйти из %@", title]
                       action:@selector(terminate:)
                keyEquivalent:@"q"];
    [appMenuItem setSubmenu:appMenu];

    NSMenuItem *editItem = [[NSMenuItem alloc] init];
    [menubar addItem:editItem];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Правка"];
    [editMenu addItemWithTitle:@"Отменить" action:@selector(undo:) keyEquivalent:@"z"];
    [editMenu addItemWithTitle:@"Вырезать" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"Копировать" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"Вставить" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"Выделить всё" action:@selector(selectAll:) keyEquivalent:@"a"];
    [editItem setSubmenu:editMenu];

    NSMenuItem *winItem = [[NSMenuItem alloc] init];
    [menubar addItem:winItem];
    NSMenu *winMenu = [[NSMenu alloc] initWithTitle:@"Окно"];
    [winMenu addItemWithTitle:@"Свернуть" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
    [winMenu addItemWithTitle:@"Полноэкранный режим" action:@selector(toggleFullScreen:) keyEquivalent:@"f"];
    [winMenu addItemWithTitle:@"Закрыть окно" action:@selector(performClose:) keyEquivalent:@"w"];
    [winItem setSubmenu:winMenu];

    [NSApp setMainMenu:menubar];
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    (void)notification;
    NSApp.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    [self setupMenus];

    WKWebViewConfiguration *cfg = [[WKWebViewConfiguration alloc] init];
    self.schemeHandler = [[FmsSchemeHandler alloc] initWithCtx:self.ctx];
    [cfg setURLSchemeHandler:self.schemeHandler forURLScheme:@"fms"];
    [cfg.userContentController addScriptMessageHandler:self name:@"fmsSave"];

    NSRect frame = NSMakeRect(0, 0, 1440, 920);
    NSUInteger style = NSWindowStyleMaskTitled
                     | NSWindowStyleMaskClosable
                     | NSWindowStyleMaskMiniaturizable
                     | NSWindowStyleMaskResizable;
    self.window = [[NSWindow alloc] initWithContentRect:frame
                                              styleMask:style
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];
    self.window.title = self.appTitle ?: @"Fantasy Map Studio";
    self.window.backgroundColor = [NSColor colorWithSRGBRed:0.090 green:0.075 blue:0.055 alpha:1.0];
    self.window.minSize = NSMakeSize(1020, 680);
    [self.window center];

    self.webView = [[WKWebView alloc] initWithFrame:self.window.contentView.bounds configuration:cfg];
    self.webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self.webView setValue:@NO forKey:@"drawsBackground"];
    self.window.contentView = self.webView;

    NSURLRequest *req = [NSURLRequest requestWithURL:[NSURL URLWithString:@"fms://app/"]];
    [self.webView loadRequest:req];

    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    (void)sender;
    return YES;
}

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
    (void)userContentController;
    if (![message.name isEqualToString:@"fmsSave"]) {
        return;
    }
    if (![message.body isKindOfClass:[NSDictionary class]]) {
        return;
    }
    NSDictionary *dict = (NSDictionary *)message.body;
    NSString *urlStr = [dict[@"url"] isKindOfClass:[NSString class]] ? dict[@"url"] : @"";
    NSString *filename = [dict[@"filename"] isKindOfClass:[NSString class]] ? dict[@"filename"] : @"map.png";
    if (urlStr.length == 0) {
        return;
    }

    NSString *target = urlStr;
    if ([target hasPrefix:@"fms://app"]) {
        target = [target substringFromIndex:9];
    }
    if (![target hasPrefix:@"/"]) {
        target = [@"/" stringByAppendingString:target];
    }

    const void *ctx = self.ctx;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        FmsBuf buf = fms_handle_request(ctx, [target UTF8String]);
        NSInteger status = (NSInteger)buf.status;
        NSData *body = (buf.data && buf.len > 0)
            ? [NSData dataWithBytes:buf.data length:buf.len]
            : [NSData data];
        fms_free_buf(buf);
        if (status != 200 || body.length == 0) {
            return;
        }
        dispatch_async(dispatch_get_main_queue(), ^{
            NSSavePanel *panel = [NSSavePanel savePanel];
            panel.nameFieldStringValue = filename;
            panel.canCreateDirectories = YES;
            [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result) {
                if (result == NSModalResponseOK && panel.URL) {
                    [body writeToURL:panel.URL atomically:YES];
                }
            }];
        });
    });
}

@end

void fms_run_macos_app(const void *ctx, const char *title) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
        FmsAppDelegate *del = [[FmsAppDelegate alloc] init];
        del.ctx = ctx;
        del.appTitle = title ? [NSString stringWithUTF8String:title] : @"Fantasy Map Studio";
        [NSApp setDelegate:del];
        [NSApp run];
    }
}
