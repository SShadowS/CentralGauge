codeunit 70983 "CG X138 Doc Matcher"
{
    /// Records an inbound document and indexes it by its external reference.
    procedure ImportInboundDoc(No: Code[20]; ExternalRef: Text[100]; Amount: Decimal)
    var
        InboundDoc: Record "CG X138 Inbound Doc";
        DocIndex: Record "CG X138 Doc Index";
        RefBuffer: Text[100];
        MatchKey: Code[20];
    begin
        RefBuffer := ExternalRef;
        MatchKey := NormalizeExternalRef(RefBuffer);

        InboundDoc.Init();
        InboundDoc."No." := No;
        InboundDoc."External Ref" := RefBuffer;
        InboundDoc.Amount := Amount;
        InboundDoc.Insert();

        DocIndex.Init();
        DocIndex."Match Key" := MatchKey;
        DocIndex."Doc No." := No;
        DocIndex.Insert();
    end;

    /// Looks an incoming reference up against everything already indexed and logs the attempt.
    procedure TryMatchIncoming(IncomingRef: Text[100]): Boolean
    var
        DocIndex: Record "CG X138 Doc Index";
        MatchLog: Record "CG X138 Match Log";
        RefBuffer: Text[100];
        MatchKey: Code[20];
        Matched: Boolean;
    begin
        RefBuffer := IncomingRef;
        MatchKey := NormalizeExternalRef(RefBuffer);
        Matched := DocIndex.Get(MatchKey);

        MatchLog.Init();
        MatchLog."Entry No." := NextLogEntryNo();
        MatchLog."Incoming Ref" := RefBuffer;
        MatchLog."Match Key Used" := MatchKey;
        if Matched then
            MatchLog."Matched Doc No." := DocIndex."Doc No.";
        MatchLog.Insert();

        exit(Matched);
    end;

    /// What an incoming reference would resolve to, without recording anything.
    procedure PreviewMatchKey(ExternalRef: Text[100]): Code[20]
    var
        RefBuffer: Text[100];
    begin
        RefBuffer := ExternalRef;
        exit(NormalizeExternalRef(RefBuffer));
    end;

    /// Looks an inbound document up directly by its own document number.
    procedure MatchByDocNo(DocNo: Code[20]): Boolean
    var
        InboundDoc: Record "CG X138 Inbound Doc";
    begin
        exit(InboundDoc.Get(DocNo));
    end;

    local procedure NextLogEntryNo(): Integer
    var
        MatchLog: Record "CG X138 Match Log";
    begin
        if MatchLog.FindLast() then
            exit(MatchLog."Entry No." + 1);
        exit(1);
    end;

    /// The lookup key used to index and match this reference.
    local procedure NormalizeExternalRef(var RawRef: Text[100]) NormalizedKey: Code[20]
    var
        Working: Text[100];
        Cleaned: Text[100];
        Ch: Text[1];
        i: Integer;
    begin
        Working := UpperCase(RawRef);
        for i := 1 to StrLen(Working) do begin
            Ch := CopyStr(Working, i, 1);
            if ((Ch >= 'A') and (Ch <= 'Z')) or ((Ch >= '0') and (Ch <= '9')) then
                Cleaned := Cleaned + Ch;
        end;
        NormalizedKey := CopyStr(Cleaned, 1, MaxStrLen(NormalizedKey));
    end;
}
