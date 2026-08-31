codeunit 70750 "CG X115 Change Detector"
{
    procedure IsSameMoment(First: DateTime; Second: DateTime): Boolean
    begin
        if (First = 0DT) or (Second = 0DT) then
            exit(First = Second);
        exit(Abs(First - Second) < 10);
    end;

    procedure ShouldResync(CurrentModifiedAt: DateTime; LastSyncedModifiedAt: DateTime): Boolean
    begin
        if LastSyncedModifiedAt = 0DT then
            exit(true);
        exit(not IsSameMoment(CurrentModifiedAt, LastSyncedModifiedAt));
    end;
}
