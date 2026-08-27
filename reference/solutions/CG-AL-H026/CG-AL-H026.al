codeunit 70226 "CG Record Converter"
{
    Access = Public;

    procedure RecordToRecordRef(SourceRecord: Record "CG Test Record"): RecordRef
    var
        TargetRef: RecordRef;
    begin
        TargetRef := SourceRecord;
        exit(TargetRef);
    end;

    procedure RecordRefToRecord(SourceRef: RecordRef): Record "CG Test Record"
    var
        TargetRecord: Record "CG Test Record";
    begin
        TargetRecord := SourceRef;
        exit(TargetRecord);
    end;

    procedure PassRecordAsRecordRef(SourceRecord: Record "CG Test Record"): Text
    begin
        exit(GetTableNameFromRef(SourceRecord));
    end;

    procedure RoundTripConversion(SourceRecord: Record "CG Test Record"): Record "CG Test Record"
    var
        TargetRecord: Record "CG Test Record";
        IntermediateRef: RecordRef;
    begin
        IntermediateRef := SourceRecord;
        TargetRecord := IntermediateRef;
        exit(TargetRecord);
    end;

    local procedure GetTableNameFromRef(SourceRef: RecordRef): Text
    begin
        exit(SourceRef.Name);
    end;
}