codeunit 70003 "Purchase Approval Workflow"
{
    var
        ApprovalHistory: Dictionary of [Code[20], Integer];
        ApprovalStatus: Dictionary of [Code[20], Text];
        ApprovalTimestamp: Dictionary of [Code[20], DateTime];
        TimeoutHours: Integer;
        ThresholdLow: Decimal;
        ThresholdMedium: Decimal;
        ThresholdHigh: Decimal;

    trigger OnRun()
    begin
        InitializeThresholds();
    end;

    local procedure InitializeThresholds()
    begin
        ThresholdLow := 1000;
        ThresholdMedium := 10000;
        ThresholdHigh := 100000;
        TimeoutHours := 48;
    end;

    procedure InitiateApprovalProcess(PurchaseHeader: Record "Purchase Header"): Boolean
    var
        Approver: Code[50];
        CurrentCount: Integer;
    begin
        InitializeThresholds();
        if PurchaseHeader."No." = '' then
            exit(false);

        Approver := DetermineApprover(PurchaseHeader);
        if Approver = '' then
            exit(false);

        if ApprovalStatus.ContainsKey(PurchaseHeader."No.") then
            ApprovalStatus.Set(PurchaseHeader."No.", 'PENDING')
        else
            ApprovalStatus.Add(PurchaseHeader."No.", 'PENDING');

        if ApprovalTimestamp.ContainsKey(PurchaseHeader."No.") then
            ApprovalTimestamp.Set(PurchaseHeader."No.", CurrentDateTime())
        else
            ApprovalTimestamp.Add(PurchaseHeader."No.", CurrentDateTime());

        if ApprovalHistory.ContainsKey(PurchaseHeader."No.") then begin
            CurrentCount := ApprovalHistory.Get(PurchaseHeader."No.");
            ApprovalHistory.Set(PurchaseHeader."No.", CurrentCount + 1);
        end else
            ApprovalHistory.Add(PurchaseHeader."No.", 1);

        LogAction(PurchaseHeader."No.", 'INITIATED', Approver);
        exit(NotifyApprovers(PurchaseHeader));
    end;

    procedure ProcessApprovalRequest(DocumentNo: Code[20]; Action: Text; Comment: Text): Boolean
    var
        CurrentCount: Integer;
        NormalizedAction: Text;
    begin
        if DocumentNo = '' then
            exit(false);

        if not ApprovalStatus.ContainsKey(DocumentNo) then
            exit(false);

        NormalizedAction := UpperCase(Action);
        case NormalizedAction of
            'APPROVE':
                ApprovalStatus.Set(DocumentNo, 'APPROVED');
            'REJECT':
                ApprovalStatus.Set(DocumentNo, 'REJECTED');
            else
                exit(false);
        end;

        if ApprovalHistory.ContainsKey(DocumentNo) then begin
            CurrentCount := ApprovalHistory.Get(DocumentNo);
            ApprovalHistory.Set(DocumentNo, CurrentCount + 1);
        end else
            ApprovalHistory.Add(DocumentNo, 1);

        LogAction(DocumentNo, NormalizedAction, Comment);

        if NormalizedAction = 'APPROVE' then
            CompleteApprovalProcess(DocumentNo);
        exit(true);
    end;

    procedure NotifyApprovers(PurchaseHeader: Record "Purchase Header"): Boolean
    var
        Approver: Code[50];
    begin
        Approver := DetermineApprover(PurchaseHeader);
        if Approver = '' then
            exit(false);

        SendEmailNotification(PurchaseHeader, 'Approval Required for Document ' + PurchaseHeader."No.");
        LogAction(PurchaseHeader."No.", 'NOTIFIED', Approver);
        exit(true);
    end;

    procedure EscalateApproval(DocumentNo: Code[20]): Boolean
    var
        CurrentCount: Integer;
    begin
        if not ApprovalStatus.ContainsKey(DocumentNo) then
            exit(false);

        if ApprovalStatus.Get(DocumentNo) <> 'PENDING' then
            exit(false);

        ApprovalStatus.Set(DocumentNo, 'ESCALATED');
        if ApprovalHistory.ContainsKey(DocumentNo) then begin
            CurrentCount := ApprovalHistory.Get(DocumentNo);
            ApprovalHistory.Set(DocumentNo, CurrentCount + 1);
        end;
        LogAction(DocumentNo, 'ESCALATED', 'Escalated due to timeout or rule');
        exit(true);
    end;

    procedure CompleteApprovalProcess(DocumentNo: Code[20]): Boolean
    var
        CurrentCount: Integer;
    begin
        if not ApprovalStatus.ContainsKey(DocumentNo) then
            exit(false);

        ApprovalStatus.Set(DocumentNo, 'COMPLETED');
        if ApprovalHistory.ContainsKey(DocumentNo) then begin
            CurrentCount := ApprovalHistory.Get(DocumentNo);
            ApprovalHistory.Set(DocumentNo, CurrentCount + 1);
        end;
        LogAction(DocumentNo, 'COMPLETED', '');
        exit(true);
    end;

    procedure DetermineApprover(PurchaseHeader: Record "Purchase Header"): Code[50]
    var
        TotalAmount: Decimal;
    begin
        InitializeThresholds();
        PurchaseHeader.CalcFields(Amount);
        TotalAmount := PurchaseHeader.Amount;

        case true of
            TotalAmount <= ThresholdLow:
                exit('SUPERVISOR');
            (TotalAmount > ThresholdLow) and (TotalAmount <= ThresholdMedium):
                exit('MANAGER');
            (TotalAmount > ThresholdMedium) and (TotalAmount <= ThresholdHigh):
                exit('DIRECTOR');
            TotalAmount > ThresholdHigh:
                exit('CEO');
        end;
        exit('');
    end;

    procedure GetApprovalHistoryCount(DocumentNo: Code[20]): Integer
    begin
        if ApprovalHistory.ContainsKey(DocumentNo) then
            exit(ApprovalHistory.Get(DocumentNo));
        exit(0);
    end;

    procedure CheckTimeout(DocumentNo: Code[20]): Boolean
    var
        StartTime: DateTime;
        ElapsedDuration: Duration;
        TimeoutDuration: Duration;
    begin
        InitializeThresholds();
        if not ApprovalTimestamp.ContainsKey(DocumentNo) then
            exit(false);

        StartTime := ApprovalTimestamp.Get(DocumentNo);
        ElapsedDuration := CurrentDateTime() - StartTime;
        TimeoutDuration := TimeoutHours * 60 * 60 * 1000;

        if ElapsedDuration > TimeoutDuration then begin
            LogAction(DocumentNo, 'TIMEOUT', 'Approval timed out');
            exit(true);
        end;
        exit(false);
    end;

    procedure SendEmailNotification(PurchaseHeader: Record "Purchase Header"; Subject: Text)
    var
        BodyText: Text;
    begin
        BodyText := StrSubstNo('Document %1 requires approval. Vendor: %2', PurchaseHeader."No.", PurchaseHeader."Buy-from Vendor No.");
        LogAction(PurchaseHeader."No.", 'EMAIL_SENT', Subject + ' | ' + BodyText);
    end;

    local procedure LogAction(DocumentNo: Code[20]; ActionType: Text; Details: Text)
    begin
        Session.LogMessage('PAW001', StrSubstNo('Document: %1, Action: %2, Details: %3', DocumentNo, ActionType, Details),
            Verbosity::Normal, DataClassification::SystemMetadata, TelemetryScope::ExtensionPublisher, 'Category', 'PurchaseApproval');
    end;

    [EventSubscriber(ObjectType::Table, Database::"Purchase Header", 'OnAfterInsertEvent', '', false, false)]
    local procedure OnAfterInsertPurchaseHeader(var Rec: Record "Purchase Header"; RunTrigger: Boolean)
    begin
        if Rec.IsTemporary() then
            exit;
        LogAction(Rec."No.", 'DOCUMENT_CREATED', Format(Rec."Document Type"));
    end;

    [EventSubscriber(ObjectType::Table, Database::"Purchase Header", 'OnAfterModifyEvent', '', false, false)]
    local procedure OnAfterModifyPurchaseHeader(var Rec: Record "Purchase Header"; var xRec: Record "Purchase Header"; RunTrigger: Boolean)
    begin
        if Rec.IsTemporary() then
            exit;
        if ApprovalStatus.ContainsKey(Rec."No.") then
            LogAction(Rec."No.", 'DOCUMENT_MODIFIED', '');
    end;

    [EventSubscriber(ObjectType::Table, Database::"Purchase Header", 'OnAfterDeleteEvent', '', false, false)]
    local procedure OnAfterDeletePurchaseHeader(var Rec: Record "Purchase Header"; RunTrigger: Boolean)
    begin
        if Rec.IsTemporary() then
            exit;
        if ApprovalStatus.ContainsKey(Rec."No.") then begin
            ApprovalStatus.Remove(Rec."No.");
            LogAction(Rec."No.", 'DOCUMENT_DELETED', '');
        end;
    end;
}