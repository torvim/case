#!/usr/bin/env node
var globalSocket;
var app = require("express")();
var http = require("http").createServer(app);
var chokidar = require("chokidar");
var path = require("path");
var io = require("socket.io")(http);
var multer  = require("multer");
var upload = multer({ dest: 'cache/' });
const ext = ["ase","art","bmp","blp","cd5","cit","cpt","cr2","cut","dds","dib","djvu","egt","exif","gif","gpl","grf","icns","ico","iff","jng","jpeg","jpg","jfif","jp2","jps","lbm","max","miff","mng","msp","nitf","ota","pbm","pc1","pc2","pc3","pcf","pcx","pdn","pgm","PI1","PI2","PI3","pict","pct","pnm","pns","ppm","psb","psd","pdd","psp","px","pxm","pxr","qfx","raw","rle","sct","sgi","rgb","int","bw","tga","tiff","tif","vtf","xbm","xcf","xpm","3dv","amf","ai","awg","cgm","cdr","cmx","dxf","e2d","egt","eps","fs","gbr","odg","svg","stl","vrml","x3d","sxd","v2d","vnd","wmf","emf","art","xar","png","webp","jxr","hdp","wdp","cur","ecw","iff","lbm","liff","nrrd","pam","pcx","pgf","sgi","rgb","rgba","bw","int","inta","sid","ras","sun","tga"]

const fs = require("fs");
const https = require("https");
const getSize = require("get-folder-size");
const imageThumbnail = require("image-thumbnail");

var imgDir = __dirname + "/public/img/";
var thumbDir =  __dirname + "/public/thumbnails/";
var watcherThumb = chokidar.watch(thumbDir, { ignored: /^\./, persistent: true });
var cpUpload = upload.fields([{ name: 'img', maxCount: 100 }])

function endsWithAny(suffixes, string) {
    return suffixes.some(function (suffix) {
        return string.endsWith(suffix);
    });
}

function getImgSize() {
    getSize(imgDir, (err, size) => {
        if (err) {
            throw err;
        }

        size = (size / 1024 / 1024).toFixed(2);

        if (globalSocket) {
            globalSocket.emit("imgSize", size);
        }
    });
}

function generateThumb(filePath, fileOrUrl) {
    if (fileOrUrl != "file") {
        var thumbPath = thumbDir + filePath.split("/").pop();
    } else {
        var thumbPath = thumbDir + path.basename(filePath);
    }

    if (fileOrUrl != "file") {
        if (!filePath.startsWith("http")) {
            filePath = "https://" + filePath;
        }

        filePath = {
            uri: filePath.toString()
        }
    }

    if(endsWithAny(ext, filePath)){
	    imageThumbnail(filePath, { width: 400 }).then(thumbnail => {
	        fs.writeFile(thumbPath, thumbnail, function(err) {
	            if (err) {
	                return console.log(err);
	            }

	            console.log("generated", thumbPath);
	        }); 
	    }).catch(err => console.error(err));
    }
}

function deleteThumb(filePath) {
    var base = path.basename(filePath).replace(/\.[^/.]+$/, "");
    var ext = path.extname(path.basename(filePath));
    fs.unlinkSync(thumbDir + base + ext);
}

function updateClient(filePath) {
    if (globalSocket) {
        var base = path.basename(filePath);
        globalSocket.emit("updateClient", base);
    }
}

function removeClient(filePath) {
    if (globalSocket) {
        var base = path.basename(filePath);
        globalSocket.emit('removeClient', base);
    }
}

function updateImg(action, filePath) {
    if (action == "add") {
        generateThumb(filePath, "file");
    } else if (action == "delete") {
        deleteThumb(filePath);
        removeClient(filePath);
    }

    getImgSize();
}

function readFiles(dir) {
    return fs.readdirSync(dir, function(err, files) {
        files = files.map(function (fileName) {
            return {
                name: fileName,
                time: fs.statSync(dir + '/' + fileName).mtime.getTime()
            };
        }).sort(function (a, b) {
            return a.time - b.time;
        }).map(function (v) {
            return v.name;
        });

        return files;
    }); 
}

function thumbList(socket) {
    files = readFiles(thumbDir);
    socket.emit("thumbList", files);
}

function clear_thumbs() {
    fs.readdir(thumbDir, function(err, files) {
        files.forEach(function(file) {
            if(file != ".placeholder"){
                fs.unlinkSync(thumbDir + file);
            }
        });
    });
}

app.get("/*", function(req, res) {
    res.sendFile(__dirname + "/public/" + req.path.replace("%20", " "));
});


app.post('/addImage', cpUpload, function (req, res, next) {
    var original = req.files.img[0].originalname;
    var fileName = req.files.img[0].filename;

    fs.rename("cache/" + fileName, imgDir + original, function (err) {
        if (err) {
            throw err;
        }

        res.redirect("back");
    });
});

function endsWithAny(suffixes, string) {
    return suffixes.some(function (suffix) {
        return string.endsWith(suffix);
    });
}

io.on("connection", function(socket) {
    thumbList(socket);
    globalSocket = socket;
    getImgSize();

    socket.on("downloadUrl", function(s) {
        if (endsWithAny([".jpg", ".jpeg", ".png"], s)) {
            generateThumb(s, "url");
        }
    });
});


if (require.main === module) {
    var args = process.argv.slice(2);

	if(args[0]){
		imgDir = path.resolve(args[0])
	}
	var watcherImg = chokidar.watch(imgDir, {ignored: /^\./, persistent: true});

    http.listen(3000, function() {
        clear_thumbs();

        watcherImg
        .on("add", function(ipath) {
            updateImg("add", ipath);
        })
        .on("change", function(ipath) {
            updateImg("change", ipath);
        })
        .on("unlink", function(ipath) {
            updateImg("delete", ipath);
        })

        watcherThumb
        .on("add", function(ipath) {
            updateClient(ipath)
        })
        .on("change", function(ipath) {
            updateClient(ipath)
        })
        .on("unlink", function(ipath) {
            updateClient(ipath)
        })
    });
}