pipeline {
    agent any

    environment {
        PROJECT_NAME = 'wisepencloud'
        DOCKER_REGISTRY = 'local'
        IMAGE_TAG = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
    }

    parameters {
        string(name: 'BRANCH_NAME', defaultValue: 'main', description: '选择需要构建的 Git 分支')
    }

    stages {
        stage('1. 拉取代码 (Checkout)') {
            steps {
                echo "开始拉取边车项目 ${params.BRANCH_NAME} 分支代码..."
                checkout scm
                echo "✅ 代码拉取成功，当前构建版本 TAG: ${IMAGE_TAG}"
            }
        }

        stage('2. 并行构建并推送镜像 (Docker Build & Push)') {
            failFast true

            parallel {
                stage('Note Collab Service') {
                    steps {
                        echo "开始执行 Node.js 多阶段构建..."
                        script {
                            dir('wisepen-note-collab-service') {
                                // 构建镜像并打上 Git Hash Tag 和 latest Tag
                                sh "docker build -t ${DOCKER_REGISTRY}/${PROJECT_NAME}-note-collab:${IMAGE_TAG} -t ${DOCKER_REGISTRY}/${PROJECT_NAME}-note-collab:latest ."
                            }
                        }
                    }
                }
            }
        }

        stage('3. 自动化部署 (Deploy)') {
            environment {
                NACOS_USER = credentials('nacos-username')
                NACOS_PWD  = credentials('nacos-password')
            }
            steps {
                script {
                    echo "开始部署 Sidecar 最新版本: ${IMAGE_TAG} ..."
                    
                    // 进入你截图中的 deploy 目录
                    dir('./') {
                        sh """
                        # 如果没有 docker-compose，则静默下载最新独立版
                        if ! command -v docker-compose &> /dev/null; then
                            echo "容器内缺失 docker-compose，正在自动下载..."
                            curl -L -# -o /usr/local/bin/docker-compose "https://github.com/docker/compose/releases/latest/download/docker-compose-\$(uname -s)-\$(uname -m)"
                            chmod +x /usr/local/bin/docker-compose
                        fi

                        # 导出环境变量，供同目录下的 docker-compose.yml 抓取 (替代 .env)
                        export APP_VERSION=${IMAGE_TAG}
                        export DOCKER_REGISTRY=${DOCKER_REGISTRY}
                        export NACOS_USERNAME=\${NACOS_USER}
                        export NACOS_PASSWORD=\${NACOS_PWD}

                        # 启动独立部署，并清理旧容器
                        docker-compose up -d --remove-orphans
                        """
                    }
                }
            }
        }
    }

    // 后置处理钩子，保持宿主机干净清爽
    post {
        always {
            echo "执行 Docker 垃圾回收..."
            sh 'docker image prune -f'
        }
        success {
            echo "🎉 构建与部署大功告成！版本: ${IMAGE_TAG}"
        }
        failure {
            echo "❌ 流水线执行失败，请检查 Jenkins 控制台报错日志！"
        }
    }
}
