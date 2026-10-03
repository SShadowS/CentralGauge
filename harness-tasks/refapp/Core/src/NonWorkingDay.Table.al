table 70008 "CGR Non-Working Day"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Non-Working Date"; Date) { }
        field(2; Description; Text[100]) { }
    }

    keys
    {
        key(PK; "Non-Working Date") { Clustered = true; }
    }
}
