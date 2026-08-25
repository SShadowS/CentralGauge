table 70793 "CG X119 GL Account"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; Name; Text[50]) { }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }
}
