codeunit 87401 "HX097 List Spy"
{
    EventSubscriberInstance = Manual;

    var
        Calls: Integer;
        MarkerNo: Integer;

    procedure HX097SetMarker(EntryNo: Integer)
    begin
        MarkerNo := EntryNo;
    end;

    procedure HX097Calls(): Integer
    begin
        exit(Calls);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental Approvals", 'OnAfterBuildApprovalList', '', false, false)]
    local procedure HX097AddMarker(UserID: Code[50]; var Result: Record "CGR Approval Entry" temporary)
    begin
        Calls += 1;
        Result.Init();
        Result."Entry No." := MarkerNo;
        Result."Table ID" := 0;
        Result."Approver ID" := UserID;
        if Result.Insert() then;
    end;
}
