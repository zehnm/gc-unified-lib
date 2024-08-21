# Contributing

First off, thanks for taking the time to contribute!

Found a bug, typo, missing feature or a description that doesn't make sense or needs clarification?  
Great, please let us know!

### Bug Reports :bug:

If you find a bug, please search for it first in the [GitHub issues](https://github.com/zehnm/gc-unified-lib/issues),
and if it isn't already tracked, [create a new issue](https://github.com/zehnm/gc-unified-lib/issues/new).

### New Features :bulb:

If you'd like to see or add new functionality to the library, describe the problem you want to solve in a
[new Issue](https://github.com/zehnm/gc-unified-lib/issues/new).

### Pull Requests

**Any pull request needs to be reviewed and approved by the Unfolded Circle development team.**

We love contributions from everyone.

⚠️ If you plan to make substantial changes, we kindly ask you, that you please reach out to us first.  
Either by opening a feature request describing your proposed changes before submitting code, or by contacting us on
one of the other [feedback channels](#feedback-speech_balloon).

Since this library is being used in an integration driver running on the embedded UC Remote devices,
we have to make sure it remains compatible with the embedded runtime environment and runs smoothly.

Submitting pull requests for typos, formatting issues etc. are happily accepted and usually approved relatively quick.

With that out of the way, here's the process of creating a pull request and making sure it passes the automated tests:

### Contributing Code :bulb:

1. Fork the repository.

2. Make your changes or enhancements.  
   This should be done in a dedicated branch and not on the main branch to easily submit individual pull requests.

   Contributed code must be licensed under MIT License.  

3. Make sure your changes pass the unit tests and tests are added for new or changed functionality:
    ```shell
    npm run test
    ```

4. Make sure your changes follow the configured prettier code style:
    ```shell
    npm run format
    ```

5. Make sure your changes make the lints pass:
    ```shell
    npm run lint
    ```

6. Push to your fork.  

7. Submit a pull request.

At this point we will review the PR and give constructive feedback.  
This is a time for discussion and improvements, and making the necessary changes will be required before we can
merge the contribution. Furthermore, all the automated checks must pass.

### Feedback :speech_balloon:

There are a few different ways to provide feedback:

- [Create a new issue](https://github.com/zehnm/gc-unified-lib/issues/new)
- [Reach out to us on Twitter](https://twitter.com/unfoldedcircle)
- [Visit our community forum](http://unfolded.community/)
- [Chat with us in our Discord channel](http://unfolded.chat/)
- [Send us a message on our website](https://unfoldedcircle.com/contact)
