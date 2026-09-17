const API =
  "https://podcast-api.pradeepsasindu2001.workers.dev";

const audioFile =
  document.getElementById("audioFile");

const uploadButton =
  document.getElementById("uploadButton");

const uploadStatus =
  document.getElementById("uploadStatus");

const progressContainer =
  document.getElementById("progressContainer");

const progressBar =
  document.getElementById("progressBar");

const playerSection =
  document.getElementById("playerSection");

const audioPlayer =
  document.getElementById("audioPlayer");

const audioTitle =
  document.getElementById("audioTitle");

const backButton =
  document.getElementById("backButton");

const forwardButton =
  document.getElementById("forwardButton");

const speed =
  document.getElementById("speed");

const shareSection =
  document.getElementById("shareSection");

const shareLink =
  document.getElementById("shareLink");

const copyButton =
  document.getElementById("copyButton");


function resetUploadState() {
  progressBar.style.width = "0%";
  uploadStatus.textContent = "";

  playerSection.classList.add("hidden");
  shareSection.classList.add("hidden");

  audioPlayer.removeAttribute("src");
  audioPlayer.load();
}


audioFile.addEventListener(
  "change",
  resetUploadState
);


uploadButton.addEventListener(
  "click",
  function () {

    const file =
      audioFile.files[0];

    if (!file) {
      uploadStatus.textContent =
        "Choose an audio file first.";
      return;
    }


    if (
      file.type &&
      !file.type.startsWith("audio/")
    ) {
      uploadStatus.textContent =
        "Please choose a valid audio file.";
      return;
    }


    const maxSize =
      80 * 1024 * 1024;


    if (file.size > maxSize) {
      uploadStatus.textContent =
        "File is larger than 80 MB.";
      return;
    }


    uploadButton.disabled = true;
    audioFile.disabled = true;

    uploadStatus.textContent =
      "Uploading...";

    progressContainer.classList.remove(
      "hidden"
    );

    progressBar.style.width =
      "0%";


    const xhr =
      new XMLHttpRequest();


    xhr.open(
      "POST",
      API + "/upload"
    );


    const mimeType =
      file.type || "audio/mpeg";


    xhr.setRequestHeader(
      "Content-Type",
      mimeType
    );


    xhr.setRequestHeader(
      "X-File-Name",
      encodeURIComponent(file.name)
    );


    xhr.upload.addEventListener(
      "progress",
      function (event) {

        if (!event.lengthComputable) {
          return;
        }


        const percent =
          Math.round(
            event.loaded /
            event.total *
            100
          );


        progressBar.style.width =
          percent + "%";


        uploadStatus.textContent =
          "Uploading " +
          percent +
          "%";
      }
    );


    xhr.onload = function () {

      uploadButton.disabled =
        false;

      audioFile.disabled =
        false;


      if (
        xhr.status < 200 ||
        xhr.status >= 300
      ) {

        uploadStatus.textContent =
          "Upload failed.";

        console.error(
          xhr.responseText
        );

        return;
      }


      try {

        const result =
          JSON.parse(
            xhr.responseText
          );


        if (!result.ok) {

          uploadStatus.textContent =
            result.error ||
            "Upload failed.";

          return;
        }


        progressBar.style.width =
          "100%";


        uploadStatus.textContent =
          "Upload complete";


        audioPlayer.src =
          result.audioUrl;


        audioTitle.textContent =
          file.name;


        shareLink.value =
          result.audioUrl;


        playerSection.classList.remove(
          "hidden"
        );


        shareSection.classList.remove(
          "hidden"
        );


        audioPlayer.load();


      } catch (error) {

        uploadStatus.textContent =
          "Invalid server response.";

        console.error(error);

      }

    };


    xhr.onerror = function () {

      uploadButton.disabled =
        false;

      audioFile.disabled =
        false;

      uploadStatus.textContent =
        "Network error.";

    };


    xhr.send(file);

  }
);



backButton.addEventListener(
  "click",
  function () {

    audioPlayer.currentTime =
      Math.max(
        0,
        audioPlayer.currentTime - 15
      );

  }
);



forwardButton.addEventListener(
  "click",
  function () {

    if (
      Number.isFinite(
        audioPlayer.duration
      )
    ) {

      audioPlayer.currentTime =
        Math.min(
          audioPlayer.duration,
          audioPlayer.currentTime + 15
        );

    }

  }
);



speed.addEventListener(
  "change",
  function () {

    audioPlayer.playbackRate =
      Number(this.value);

  }
);



copyButton.addEventListener(
  "click",
  async function () {

    try {

      await navigator.clipboard.writeText(
        shareLink.value
      );


      copyButton.textContent =
        "Copied";


      setTimeout(
        function () {

          copyButton.textContent =
            "Copy Link";

        },
        1500
      );


    } catch (error) {

      shareLink.select();

      document.execCommand(
        "copy"
      );

    }

  }
);
