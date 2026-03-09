from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from ..database import get_db
from ..models import User, HouseMembership, AccessLog, LogResult
from ..schemas import AccessLogResponse, AccessLogCreate
from ..auth import get_current_active_user, get_house_id_header, get_membership, require_admin_membership

router = APIRouter(prefix="/logs", tags=["Access Logs"])

@router.get("/", response_model=List[AccessLogResponse])
async def get_logs(
    filter: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    m = get_membership(db, current_user, x_house_id)
    query = db.query(AccessLog)

    if m.role == "admin":
        query = query.filter(AccessLog.house_id == m.house_id)
    else:
        query = query.filter(AccessLog.user_id == current_user.id, AccessLog.house_id == m.house_id)

    if category and category != "all":
        query = query.filter(AccessLog.category == category)

    if filter and filter != "all":
        if filter == "success":
            query = query.filter(AccessLog.result == LogResult.success)
        elif filter == "failed":
            query = query.filter(AccessLog.result == LogResult.failed)
        elif filter == "alert":
            query = query.filter(AccessLog.result == LogResult.alert)

    if search:
        search_term = f"%{search}%"
        from sqlalchemy import or_
        user_ids = [u.id for u in db.query(User).filter(User.full_name.ilike(search_term)).all()]
        query = query.filter(
            or_(
                AccessLog.action.ilike(search_term),
                AccessLog.method.ilike(search_term),
                AccessLog.user_id.in_(user_ids) if user_ids else False,
            )
        )

    query = query.order_by(AccessLog.timestamp.desc())
    logs = query.offset((page - 1) * limit).limit(limit).all()

    result = []
    for log in logs:
        user = db.query(User).filter(User.id == log.user_id).first()
        result.append(AccessLogResponse(
            id=log.id, user_id=log.user_id,
            user_name=user.full_name if user else "Unknown",
            timestamp=log.timestamp, action=log.action,
            method=log.method, result=log.result,
            category=log.category, ip_address=log.ip_address,
            device_id=log.device_id,
        ))
    return result

@router.post("/", response_model=AccessLogResponse)
async def create_log(
    log_data: AccessLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    x_house_id: Optional[str] = Depends(get_house_id_header),
):
    m = get_membership(db, current_user, x_house_id)
    log = AccessLog(
        user_id=current_user.id, house_id=m.house_id,
        action=log_data.action, method=log_data.method,
        result=log_data.result, category=log_data.category,
        ip_address=log_data.ip_address, device_id=log_data.device_id,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return AccessLogResponse(
        id=log.id, user_id=log.user_id,
        user_name=current_user.full_name,
        timestamp=log.timestamp, action=log.action,
        method=log.method, result=log.result,
        category=log.category, ip_address=log.ip_address,
        device_id=log.device_id,
    )
