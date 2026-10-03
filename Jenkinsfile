pipeline {
    agent any

    environment {
        AWS_REGION      = 'us-east-1'
        ECR_REGISTRY    = '131540502908.dkr.ecr.us-east-1.amazonaws.com'
        IMAGE_NAME      = 'devroute-api'
        IMAGE_TAG       = "${env.GIT_COMMIT[0..6]}"
        EC2_HOST        = '98.80.170.66'
        EC2_USER        = 'ubuntu'
        STAGING_PORT    = '3001'
        PROD_PORT       = '3000'
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 30, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    stages {

        // ─────────────────────────────────────────
        // 1. BUILD
        // ─────────────────────────────────────────
        stage('Build') {
            steps {
                script {
                    echo "Building image: ${IMAGE_NAME}:${IMAGE_TAG}"
                    sh """
                        docker build -t ${IMAGE_NAME}:${IMAGE_TAG} .
                        docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${IMAGE_NAME}:latest
                    """
                }
            }
        }

        // ─────────────────────────────────────────
        // 2. TEST
        // ─────────────────────────────────────────
        stage('Test') {
            steps {
                script {
                    sh """
                        docker network create test-net-${IMAGE_TAG} || true

                        # Start Postgres
                        docker run -d --name pg-${IMAGE_TAG} \
                            --network test-net-${IMAGE_TAG} \
                            -e POSTGRES_USER=devroute \
                            -e POSTGRES_PASSWORD=devroute \
                            -e POSTGRES_DB=devroute_test \
                            postgres:15-alpine

                        # Start Redis
                        docker run -d --name redis-${IMAGE_TAG} \
                            --network test-net-${IMAGE_TAG} \
                            redis:7-alpine

                        sleep 5

                        # Run tests inside the app image
                        docker run --rm \
                            --network test-net-${IMAGE_TAG} \
                            -e DATABASE_URL=postgresql://devroute:devroute@pg-${IMAGE_TAG}:5432/devroute_test \
                            -e REDIS_URL=redis://redis-${IMAGE_TAG}:6379 \
                            -e NODE_ENV=test \
                            ${IMAGE_NAME}:${IMAGE_TAG} \
                            sh -c "npx prisma migrate deploy && npm test -- --forceExit" || {
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

        // ─────────────────────────────────────────
        // 3. PUSH TO ECR
        // ─────────────────────────────────────────
        stage('Push to ECR') {
            when {
                branch 'main'
            }
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

        // ─────────────────────────────────────────
        // 4. DEPLOY TO STAGING
        // ─────────────────────────────────────────
        stage('Deploy to Staging') {
            when {
                branch 'main'
            }
            steps {
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'EC2_SSH_KEY', keyFileVariable: 'SSH_KEY'),
                    string(credentialsId: 'AWS_ACCESS_KEY_ID',     variable: 'AWS_ACCESS_KEY_ID'),
                    string(credentialsId: 'AWS_SECRET_ACCESS_KEY', variable: 'AWS_SECRET_ACCESS_KEY')
                ]) {
                    sh """
                        ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_HOST} '
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
                        '
                    """
                }
            }
            post {
                success {
                    echo "Staging deployed at http://${EC2_HOST}:${STAGING_PORT}"
                }
            }
        }

        // ─────────────────────────────────────────
        // 5. MANUAL APPROVAL GATE
        // ─────────────────────────────────────────
        stage('Approve Production Deploy') {
            when {
                branch 'main'
            }
            steps {
                timeout(time: 30, unit: 'MINUTES') {
                    input message: "Deploy ${IMAGE_NAME}:${IMAGE_TAG} to PRODUCTION?",
                          ok: 'Deploy to Production',
                          submitter: 'admin'
                }
            }
        }

        // ─────────────────────────────────────────
        // 6. DEPLOY TO PRODUCTION
        // ─────────────────────────────────────────
        stage('Deploy to Production') {
            when {
                branch 'main'
            }
            steps {
                withCredentials([
                    sshUserPrivateKey(credentialsId: 'EC2_SSH_KEY', keyFileVariable: 'SSH_KEY'),
                    string(credentialsId: 'AWS_ACCESS_KEY_ID',     variable: 'AWS_ACCESS_KEY_ID'),
                    string(credentialsId: 'AWS_SECRET_ACCESS_KEY', variable: 'AWS_SECRET_ACCESS_KEY')
                ]) {
                    sh """
                        ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_HOST} '
                            export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}"
                            export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}"
                            export AWS_DEFAULT_REGION="${AWS_REGION}"

                            # Save current image tag for rollback
                            PREV_TAG=\$(docker inspect devroute-api --format="{{.Config.Image}}" 2>/dev/null | awk -F: "{print \$2}" || echo "none")
                            echo \$PREV_TAG > /tmp/devroute-prev-tag

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
                                ${ECR_REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}

                            echo "Waiting for production to be healthy..."
                            sleep 8
                            curl -f http://localhost:${PROD_PORT}/health || {
                                echo "Health check failed — rolling back to \$PREV_TAG"
                                docker stop devroute-api || true
                                docker rm   devroute-api || true
                                docker run -d \
                                    --name devroute-api \
                                    --restart unless-stopped \
                                    -p ${PROD_PORT}:3000 \
                                    -e NODE_ENV=production \
                                    ${ECR_REGISTRY}/${IMAGE_NAME}:\$PREV_TAG
                                exit 1
                            }
                            echo "Production healthy ✓ — deployed ${IMAGE_TAG}"
                        '
                    """
                }
            }
            post {
                success {
                    echo "Production deployed: http://${EC2_HOST}:${PROD_PORT}"
                }
                failure {
                    echo "Production deploy failed — automatic rollback triggered on EC2"
                }
            }
        }

    } // end stages

    post {
        always {
            sh """
                docker rmi ${IMAGE_NAME}:${IMAGE_TAG}     || true
                docker rmi ${IMAGE_NAME}:latest           || true
                docker rmi ${ECR_REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG} || true
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