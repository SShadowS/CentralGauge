table 70332 "CG X068 Search Log"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            DataClassification = CustomerContent;
            AutoIncrement = true;
        }
        field(2; "Search Text"; Text[100])
        {
            DataClassification = CustomerContent;
        }
        field(3; "Matched Contacts"; Integer)
        {
            DataClassification = CustomerContent;
        }
        field(4; "Contactable Contacts"; Integer)
        {
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }
}
