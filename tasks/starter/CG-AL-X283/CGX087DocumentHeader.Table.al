table 70520 "CG X087 Document Header"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Copied From No."; Code[20]) { DataClassification = CustomerContent; }
        field(3; Status; Option)
        {
            OptionMembers = Open,Released,Copied;
            DataClassification = CustomerContent;
        }
        field(4; "Copy Audited"; Boolean) { DataClassification = CustomerContent; }
        field(5; Description; Text[100]) { DataClassification = CustomerContent; }
        field(6; "Release Reference"; Code[30]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
