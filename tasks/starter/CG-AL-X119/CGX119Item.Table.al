table 70792 "CG X119 Item"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; Description; Text[50]) { }
        field(3; "Description 2"; Text[50]) { }
        field(4; "Base Unit of Measure"; Code[10]) { }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }
}
