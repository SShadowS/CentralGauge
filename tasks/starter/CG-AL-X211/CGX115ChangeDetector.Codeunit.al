codeunit 70750 "CG X115 Change Detector"
{
    procedure IsSameMoment(First: DateTime; Second: DateTime): Boolean
    begin
        exit(First = Second);
    end;

    procedure ShouldResync(CurrentModifiedAt: DateTime; LastSyncedModifiedAt: DateTime): Boolean
    begin
        exit(CurrentModifiedAt <> LastSyncedModifiedAt);
    end;
}
