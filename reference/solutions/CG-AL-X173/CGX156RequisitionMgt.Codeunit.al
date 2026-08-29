codeunit 71402 "CG X156 Requisition Mgt"
{
    var
        AlreadyReleasedErr: Label 'This requisition has already been released and its quantity can no longer be changed.';

    procedure SubmitForApproval(No: Code[20])
    var
        Requisition: Record "CG X156 Requisition";
    begin
        Requisition.Get(No);
        Requisition.Status := Requisition.Status::PendingApproval;
        Requisition.Modify();
    end;

    procedure ConfirmPrepayment(No: Code[20])
    var
        Requisition: Record "CG X156 Requisition";
    begin
        Requisition.Get(No);
        Requisition.Status := Requisition.Status::PrepaymentWait;
        Requisition.Modify();
    end;

    procedure Release(No: Code[20])
    var
        Requisition: Record "CG X156 Requisition";
    begin
        Requisition.Get(No);
        Requisition.Status := Requisition.Status::Released;
        Requisition.Modify();
    end;

    procedure UpdateQuantity(No: Code[20]; NewQuantity: Decimal)
    var
        Requisition: Record "CG X156 Requisition";
    begin
        Requisition.Get(No);
        if Requisition.Status = Requisition.Status::Released then
            Error(AlreadyReleasedErr);
        Requisition.Quantity := NewQuantity;
        Requisition.Modify();
    end;
}
