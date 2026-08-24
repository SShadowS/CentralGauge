codeunit 71450 "CG X058 Deduper"
{
    Access = Internal;

    procedure DistinctCount(Labels: List of [Text]): Integer
    var
        Buffer: Record "CG X058 Buffer";
        LabelValue: Text;
        NextEntryNo: Integer;
        Distinct: Integer;
    begin
        foreach LabelValue in Labels do begin
            // "Label" is not in any key, so it must be filtered on, not
            // assigned and looked up.
            Buffer.Reset();
            Buffer.SetRange("Label", CopyStr(LabelValue, 1, MaxStrLen(Buffer."Label")));
            if Buffer.IsEmpty() then begin
                NextEntryNo += 1;
                Buffer.Init();
                Buffer."Entry No." := NextEntryNo;
                Buffer."Label" := CopyStr(LabelValue, 1, MaxStrLen(Buffer."Label"));
                Buffer.Insert();
                Distinct += 1;
            end;
        end;

        exit(Distinct);
    end;
}
