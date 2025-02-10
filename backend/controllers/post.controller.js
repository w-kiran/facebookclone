import { Post } from "../models/post.model.js";
import { User } from "../models/user.model.js"
import { Comment } from "../models/comment.model.js"
import sharp from "sharp"
import cloudinary from "../utils/cloudinary.js";
import { Reactions } from "../models/reaction.model.js";

export const addNewPost = async (req, res) => {
    try {
        const userId = req.id;
        const { caption, visibility } = req.body;
        const image = req.file;

        if (!image && !caption) {
            return res.status(201).json({
                message: "Image and caption not found",
                success: false
            })
        }

        const optimizedImageBuffer = await sharp(image.buffer)
            .resize({ width: 800, height: 800, fit: "inside" })
            .toFormat("jpeg", { quality: 80 })
            .toBuffer();

        const fileUri = `data:image/jpeg;base64,${optimizedImageBuffer.toString('base64')}`;
        const cloudResponse = await cloudinary.uploader.upload(fileUri)

        const post = await Post.create({
            caption,
            image: cloudResponse.secure_url,
            author: userId,
            visibility: visibility || 'public'
        })

        const user = await User.findById(userId)
        if (post) {
            user.posts.push(post._id)
            await post.populate({
                path: 'author',
                select: 'username profilePicture'
            })
            await user.save()
        }

        return res.status(200).json({
            message: "New Post Added.",
            success: true,
            post
        })

    } catch (error) {
        console.log(error);
    }
}

export const getAllPosts = async (req, res) => {
    try {
        const userId = req.id;
        const user = await User.findById(userId)

        const post = await Post.find({
            $or: [
                { visibility: 'public' },
                {
                    visibility: 'friends',
                    author: { $in: user.friends }
                },
                {
                    author: userId
                }
            ]
        }).sort({ createdAt: -1 })
            .populate([{
                path: 'author',
                select: 'username profilePicture'
            },
            {
                path: 'comments',
                populate: {
                    path: 'author',
                    select: 'username profilePicture'
                }
            },
            {
                path: 'reactions',
                populate: {
                    path: 'author',
                    select: 'username profilePicture'
                }
            },

            ])

        return res.status(200).json({
            message: 'Watch feed',
            success: true,
            post
        })
    } catch (error) {
        console.log(error);
    }
}

export const postReactions = async (req, res) => {
    try {
        const userId = req.id
        const postId = req.params.id;
        const post = await Post.findById(postId)
        const reactionType = req.body;
        if (!post) {
            return res.status(401).json({
                message: "Post not found",
                success: false
            })
        }

        const existingReaction = await Reactions.findOne({ author: userId, post: postId });
        if (existingReaction) {
            if (existingReaction.type === reactionType) {
                await post.reactions.pull(existingReaction._id)
                await post.save();
                return res.status(200).json({
                    message: "Reaction removed",
                    success: true
                });
            }
            else {
                existingReaction.type = reactionType
                await existingReaction.save()
                return res.status(200).json({
                    message: "Reaction updated",
                    success: true,
                    reaction: existingReaction
                });
            }
        }

        // await post.updateOne({ $addToSet: { reactions: userId } })

        const reaction = await Reactions.create({
            type: reactionType,
            author: userId,
            post: postId
        })

        await reaction.populate({
            path: 'author',
            select: "username profilePicture"
        })

        // await post.populate({
        //     path: reactions,
        //     populate: {
        //         path: 'author',
        //         select: "username profilePicture"
        //     }
        // })

        post.reactions.push(reaction._id)
        await post.save()

    } catch (error) {
        console.log(error);
    }
}

export const addComment = async (req, res) => {
    try {
        const userId = req.id;
        const postId = req.params.id;

        const { text } = req.body;

        const post = await Post.findById(postId)

        if (!text) {
            return res.status(401).json({
                message: "Text is required",
                success: false
            })
        }

        const comment = await Comment.create({
            text: text,
            author: userId,
            post: postId
        })

        await comment.populate({
            path: "author",
            select: "username profilePicture"
        })

        post.comments.push(comment._id);
        await post.save()

        return res.status(200).json({
            message: 'Comment is Added',
            comment,
            success: true
        })

    } catch (error) {
        console.log(error);
    }
}

export const getCommentsofPost = async (req, res) => {
    try {
        const postId = req.params.id;
        const comments = await Comment.find({ post: postId }).populate({
            path: "author",
            select: "username profilePicture"
        })

        if (!comments) {
            return res.status(401).json({
                message: "There is no comments for this post",
                success: false
            })
        }

        return res.status(200).json({
            message: "Comments found",
            success: true,
            comments
        })
    } catch (error) {
        console.log(error);
    }
}

export const deleteComment = async (req, res) => {
    try {
        const commentId = req.params.id;
        const comment = await Comment.findById(commentId)
            .populate('user', '_id')
            .populate('post', '_id user');

        if (!comment) {
            return res.status(404).json({ success: false, message: "Comment not found" });
        }

        // Check if user is authorized (comment author or post owner)
        if (comment.user._id.toString() !== req.user._id.toString() &&
            comment.post.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: "Unauthorized to delete this comment" });
        }

        await Comment.findByIdAndDelete(commentId);
        return res.status(200).json({ success: true, message: "Comment deleted successfully" });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
}

export const deletePost = async (req, res) => {
    try {
        const userId = req.id;
        const postId = req.params.id;

        const post = await Post.findById(postId)
        if (!post) {
            return res.status(404).json({
                message: 'Post not found', success: false
            })
        }

        if (post.author.toString() !== userId) {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        await Promise.all([
            Post.findByIdAndDelete(postId),
            Comment.deleteMany({ post: postId }),
            Reactions.deleteMany({ post: postId })
        ])

        let user = await User.findById(userId);
        user.posts = user.posts.filter(id => id.toString() != postId);
        await user.save();

        return res.status(200).json({
            message: "Post deleted successfully",
            success: true
        })

    } catch (error) {

    }
}

// export const savedPost = async (req, res) => {
//     try {
//         const postId = req.params.id;
//         const userId = req.id;

//         const post = await Post.findById(postId);

//         if (!post) {
//             return res.status(401).json({
//                 message: "post not found",
//                 success: false
//             })
//         }

//         const user = await User.findById(userId);
//         if (user.saved.includes(postId)) {
//             await user.updateOne({ $pull: { saved: postId } })
//             await user.save()
//             return res.status(200).json({
//                 message: " Saved post removed",
//                 success: true
//             })
//         } else {
//             await user.updateOne({ $addToSet: { saved: postId } })
//             await user.save();

//             const updatedUser = await User.findById(user._id).populate({
//                 path: "saved",
//                 populate: [
//                     { path: "author", select: "username profilePicture" },
//                     { path: "comment", populate: { path: "author", select: "username profilePicture" } },
//                     { path: "reaction", populate: { path: "author", select: "username profilePicture" } }
//                 ]
//             });

//             return res.status(200).json({
//                 message: " Saved post added",
//                 success: true,
//                 savedPost: updatedUser.saved
//             })
//         }
//     } catch (error) {
//         console.log(error);
//     }
// }

export const savePost = async (req, res) => {
    try {
        const userId = req.id;
        const postId = req.params.id;

        // Find user and post
        const user = await User.findById(userId);
        const post = await Post.findById(postId);

        if (!post) {
            return res.status(404).json({
                message: 'Post not found',
                success: false
            });
        }

        let updatedUser;

        if (user.saved.includes(postId)) {
            await User.findByIdAndUpdate(userId, { $pull: { saved: postId } });

            updatedUser = await User.findById(userId).populate({
                path: "saved",
                populate: [
                    { path: "author", select: "username profilePicture" },
                    { path: "comment", populate: { path: "author", select: "username profilePicture" } },
                    { path: "reaction", populate: { path: "author", select: "username profilePicture" } }
                ]
            });

            return res.status(200).json({
                message: 'Post removed from saved',
                success: true,
                savedPost: updatedUser.saved
            });
        } else {
            await User.findByIdAndUpdate(userId, { $addToSet: { saved: postId } });

            // Fetch updated user with populated saved posts
            updatedUser = await User.findById(userId).populate({
                path: "saved",
                populate: [
                    { path: "author", select: "username profilePicture" },
                    { path: "comment", populate: { path: "author", select: "username profilePicture" } },
                    { path: "reaction", populate: { path: "author", select: "username profilePicture" } }
                ]
            });

            return res.status(200).json({
                message: 'Post added to saved',
                success: true,
                savedPost: updatedUser.saved
            });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            message: 'Internal server error',
            success: false,
            error: error.message
        });
    }
};

export const sharePost = async (req, res) => {
    try {
        const userId = req.id;
        const postId = req.params.id;
        const {caption} = req.body;

        const post = await Post.findById(postId);

        if (!post) {
            return res.status(404).json({
                message: "Post not found",
                success: false
            });
        }

        let user = await User.findById(userId);

        // Create a new post with the shared post reference
        const newSharedPost = await Post.create({
            caption:caption || "",
            author: userId,
            originalPost: postId, // Store the original post reference
        });

        // Update user document with shared post
        await user.updateOne({ $addToSet: { posts: newSharedPost._id } });

        // Populate sharedPost to return updated data
        // await user.populate({
        //     path: "posts",
        //     populate: [
        //         {
        //             path: "author",
        //             select: "username profilePicture"
        //         },
        //         {
        //             path: "originalPost",
        //             populate: {
        //                 path: "author",
        //                 select: "username profilePicture caption image"
        //             }
        //         }
        //     ]
        // });

        return res.status(200).json({
            message: "Post shared successfully",
            success: true,
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            message: "Internal Server Error",
            success: false
        });
    }
};
