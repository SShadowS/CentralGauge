codeunit 70825 "CG X122 Cancellation Alerter"
{
    // Carries only the cancellation-alert subscription, so binding it for a
    // manual cancellation cannot also activate the release-side handler.
    EventSubscriberInstance = Manual;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X122 Document Processor", 'OnDocumentCancelled', '', false, false)]
    local procedure OnCancelled(DocNo: Code[20])
    begin
        LogEntry(DocNo, 'CANCELLED');
    end;

    local procedure LogEntry(DocNo: Code[20]; Kind: Code[20])
    var
        Log: Record "CG X122 Activity Log";
    begin
        Log.Init();
        Log."Entry No." := NextEntryNo();
        Log."Doc No." := DocNo;
        Log.Kind := Kind;
        Log.Insert();
    end;

    local procedure NextEntryNo(): Integer
    var
        Log: Record "CG X122 Activity Log";
    begin
        if Log.FindLast() then
            exit(Log."Entry No." + 1);
        exit(1);
    end;
}
