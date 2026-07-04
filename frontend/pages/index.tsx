import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: { destination: "/julia/demo", permanent: false },
  };
};

export default function Index() {
  return null;
}
