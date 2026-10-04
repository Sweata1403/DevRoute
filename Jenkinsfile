pipeline {
    agent any

    environment {
        AWS_REGION      = 'us-east-1'
        ECR_REGISTRY    = '131540502908.dkr.ecr.us-east-1.amazonaws.com'
        IMAGE_NAME      = 'devroute-api'
        IMAGE_TAG       = "${env.GIT_COMMIT[0..6]}"
        STAGING_PORT    = '3001'
        PROD_PORT       = '3000'
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 30, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    stages {

        stage('Build') {
            steps {
                script {
                    echo "Building image: ${IMAGE_NAME}:${IMAGE_TAG}"
                    sh """
                        docker build -t ${IMAGE_NAME}:${IMAGE_TAG} \
                            -f services/api/Dockerfile services/api/
                        docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${IMAGE_NAME}:latest
                    """
                }
            }
        }

        stage('Test') {
            steps {
                script {
                    sh """
                        docker network create test-net-${IMAGE_TAG} || true

                        docker run -d --name pg-${IMAGE_TAG} \
                            --network test-net-${IMAGE_TAG} \
                            -e POSTGRES_USER=devroute \
                            -e POSTGRES_PASSWORD=devroute \
                            -e POSTGRES_DB=devroute_test \
                            postgres:15-alpine

                        docker run -d --name redis-${IMAGE_TAG} \
                            --network test-net-${IMAGE_TAG} \
                            redis:7-alpine

                        sleep 5

                        docker run --rm \
                            --network test-net-${IMAGE_TAG} \
                            -e DATABASE_URL=postgresql://devroute:devroute@pg-${IMAGE_TAG}:5432/devroute_test \
                            -e REDIS_URL=redis://redis-${IMAGE_TAG}:6379 \
                            -e NODE_ENV=test \
                            ${IMAGE_NAME}:${IMAGE_TAG} \
                            sh -c "npm install --include=dev && npm test -- --forceExit" || {
                                docker rm -f pg-${IMAGE_TAG} redis-${IMAGE_TAG} || true
                                docker network rm test-net-${IMAGE_TAG} || true
                                exit 1
                            }

                        docker rm -f pg-${IMAGE_TAG} redis-${IMAGE_TAG} || true
                        docker network rm test-net-${IMAGE_TAG} || true
                    """
                }
            }
        }

        stage('Push to ECR') {
            steps {
                withCredentials([
                    string(credentialsId: 'AWS_ACCESS_KEY_ID',     variable: 'AWS_ACCESS_KEY_ID'),
                    string(credentialsId: 'AWS_SECRET_ACCESS_KEY', variable: 'AWS_SECRET_ACCESS_KEY')
                ]) {
                    sh """
                        aws ecr get-login-password --region ${AWS_REGION} | \
                            docker login --username AWS --password-stdin ${ECR_REGISTRY}

                        docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${ECR_REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}
                        docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${ECR_REGISTRY}/${IMAGE_NAME}:latest

                        docker push ${ECR_REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}
                        docker push ${ECR_REGISTRY}/${IMAGE_NAME}:latest
                    """
                }
            }
        }

        stage('Deploy to Staging') {
            steps {
                withCredentials([
                    string(credentialsId: 'AWS_ACCESS_KEY_ID',     variable: 'AWS_ACCESS_KEY_ID'),
                    string(credentialsId: 'AWS_SECRET_ACCESS_KEY', variable: 'AWS_SECRET_ACCESS_KEY')
                ]) {
                    sh """
                        export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}"
                        export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}"
                        export AWS_DEFAULT_REGION="${AWS_REGION}"

                        aws ecr get-login-password --region ${AWS_REGION} | \
                            docker login --username AWS --password-stdin ${ECR_REGISTRY}

                        docker pull ${ECR_REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}

                        docker stop devroute-staging || true
                        docker rm   devroute-staging || true

                        docker run -d \
                            --name devroute-staging \
                            --restart unless-stopped \
                            -p ${STAGING_PORT}:3000 \
                            -e NODE_ENV=staging \
                            ${ECR_REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}

                        echo "Waiting for staging to be healthy..."
                        sleep 8
                        curl -f http://localhost:${STAGING_PORT}/health || exit 1
                        echo "Staging healthy ✓"
                    """
                }
            }
            post {
                success {
                    echo "Staging deployed on port ${STAGING_PORT}"
                }
            }
        }

        stage('Approve Production Deploy') {
            steps {
                timeout(time: 30, unit: 'MINUTES') {
                    input message: "Deploy ${IMAGE_NAME}:${IMAGE_TAG} to PRODUCTION?",
                          ok: 'Deploy to Production',
                          submitter: 'admin'
                }
            }
        }

        stage('Deploy to Production') {
            steps {
                withCredentials([
                    string(credentialsId: 'AWS_ACCESS_KEY_ID',     variable: 'AWS_ACCESS_KEY_ID'),
                    string(credentialsId: 'AWS_SECRET_ACCESS_KEY', variable: 'AWS_SECRET_ACCESS_KEY')
                ]) {
                    sh """
                        export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}"
                        export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}"
                        export AWS_DEFAULT_REGION="${AWS_REGION}"

                        PREV_TAG=\$(docker inspect devroute-api --format='{{index .Config.Labels "image-tag"}}' 2>/dev/null || echo "none")
                        echo "Previous tag: \$PREV_TAG"

                        aws ecr get-login-password --region ${AWS_REGION} | \
                            docker login --username AWS --password-stdin ${ECR_REGISTRY}

                        docker pull ${ECR_REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}

                        docker stop devroute-api || true
                        docker rm   devroute-api || true

                        docker run -d \
                            --name devroute-api \
                            --restart unless-stopped \
                            -p ${PROD_PORT}:3000 \
                            -e NODE_ENV=production \
                            --label image-tag=${IMAGE_TAG} \
                            ${ECR_REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}

                        echo "Waiting for production to be healthy..."
                        sleep 8
                        curl -f http://localhost:${PROD_PORT}/health || {
                            echo "Health check failed — rolling back to \$PREV_TAG"
                            docker stop devroute-api || true
                            docker rm   devroute-api || true
                            if [ "\$PREV_TAG" != "none" ] && [ -n "\$PREV_TAG" ]; then
                                docker run -d \
                                    --name devroute-api \
                                    --restart unless-stopped \
                                    -p ${PROD_PORT}:3000 \
                                    -e NODE_ENV=production \
                                    --label image-tag=\$PREV_TAG \
                                    ${ECR_REGISTRY}/${IMAGE_NAME}:\$PREV_TAG
                            fi
                            exit 1
                        }
                        echo "Production healthy ✓ — deployed ${IMAGE_TAG}"
                    """
                }
            }
            post {
                success {
                    echo "Production deployed on port ${PROD_PORT}"
                }
                failure {
                    echo "Production deploy failed — automatic rollback triggered"
                }
            }
        }

    }

    post {
        always {
            sh """
                docker rmi ${IMAGE_NAME}:${IMAGE_TAG}                        || true
                docker rmi ${IMAGE_NAME}:latest                              || true
                docker rmi ${ECR_REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}       || true
                docker rmi ${ECR_REGISTRY}/${IMAGE_NAME}:latest              || true
            """
        }
        success {
            echo "Pipeline completed successfully for ${IMAGE_NAME}:${IMAGE_TAG}"
        }
        failure {
            echo "Pipeline failed — check logs above"
        }
    }

}