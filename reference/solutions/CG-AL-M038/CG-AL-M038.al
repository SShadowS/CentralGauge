codeunit 70038 "CG V16 Misc Demo"
{
    Access = Public;

    procedure GetLockTimeoutPrevious(NewValue: Integer): Integer
    begin
        exit(Database.LockTimeoutDuration(NewValue));
    end;

    procedure CountRecordRefList(): Integer
    var
        Refs: List of [RecordRef];
        CustomerRef: RecordRef;
        ItemRef: RecordRef;
    begin
        CustomerRef.Open(Database::Customer);
        ItemRef.Open(Database::Item);

        Refs.Add(CustomerRef);
        Refs.Add(ItemRef);

        exit(Refs.Count());
    end;
}