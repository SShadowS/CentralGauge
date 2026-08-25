codeunit 70802 "CG X120 Approval Reconciler"
{
    procedure InitializeRecord(RecordNo: Code[20]; ContactName: Text[50]; CreditLimit: Decimal)
    var
        ApprovedRecord: Record "CG X120 Approved Record";
    begin
        ApprovedRecord.Init();
        ApprovedRecord."No." := RecordNo;
        ApprovedRecord."Contact Name" := ContactName;
        ApprovedRecord."Credit Limit" := CreditLimit;
        ApprovedRecord."Approved Contact Name" := ContactName;
        ApprovedRecord."Approved Credit Limit" := CreditLimit;
        ApprovedRecord.Insert();
    end;

    procedure SetContactName(RecordNo: Code[20]; NewContactName: Text[50])
    var
        ApprovedRecord: Record "CG X120 Approved Record";
        Pending: Record "CG X120 Pending Verification";
    begin
        ApprovedRecord.Get(RecordNo);
        ApprovedRecord."Contact Name" := NewContactName;
        ApprovedRecord.Modify();

        if NewContactName <> ApprovedRecord."Approved Contact Name" then
            if not Pending.Get(RecordNo, 'Contact Name') then begin
                Pending.Init();
                Pending."Record No." := RecordNo;
                Pending."Field Name" := 'Contact Name';
                Pending.Insert();
            end;
    end;

    procedure SetCreditLimit(RecordNo: Code[20]; NewCreditLimit: Decimal)
    var
        ApprovedRecord: Record "CG X120 Approved Record";
        Pending: Record "CG X120 Pending Verification";
    begin
        ApprovedRecord.Get(RecordNo);
        ApprovedRecord."Credit Limit" := NewCreditLimit;
        ApprovedRecord.Modify();

        if NewCreditLimit <> ApprovedRecord."Approved Credit Limit" then
            if not Pending.Get(RecordNo, 'Credit Limit') then begin
                Pending.Init();
                Pending."Record No." := RecordNo;
                Pending."Field Name" := 'Credit Limit';
                Pending.Insert();
            end;
    end;

    procedure ApproveCurrentValues(RecordNo: Code[20])
    var
        ApprovedRecord: Record "CG X120 Approved Record";
        Pending: Record "CG X120 Pending Verification";
    begin
        ApprovedRecord.Get(RecordNo);
        ApprovedRecord."Approved Contact Name" := ApprovedRecord."Contact Name";
        ApprovedRecord."Approved Credit Limit" := ApprovedRecord."Credit Limit";
        ApprovedRecord.Modify();

        Pending.SetRange("Record No.", RecordNo);
        Pending.DeleteAll();
    end;

    procedure IsPending(RecordNo: Code[20]): Boolean
    var
        Pending: Record "CG X120 Pending Verification";
    begin
        Pending.SetRange("Record No.", RecordNo);
        exit(not Pending.IsEmpty());
    end;

    procedure IsFieldPending(RecordNo: Code[20]; FieldName: Text[50]): Boolean
    var
        Pending: Record "CG X120 Pending Verification";
    begin
        exit(Pending.Get(RecordNo, FieldName));
    end;

    procedure PendingFieldCount(RecordNo: Code[20]): Integer
    var
        Pending: Record "CG X120 Pending Verification";
    begin
        Pending.SetRange("Record No.", RecordNo);
        exit(Pending.Count());
    end;
}
