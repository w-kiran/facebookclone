import React from 'react'
import { useSelector } from 'react-redux'
import Post from './Post';

const Posts = () => {
  const { posts = [] } = useSelector((store) => store.post || {});

  return (
    <div>
      {posts?.length > 0 ? (
        posts.map((post) => <Post key={post._id} post={post} />)
      ) : (
        <p>No posts available</p>
      )}
    </div>
  );
};


export default Posts